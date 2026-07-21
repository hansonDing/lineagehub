/**
 * 演示模式模拟 API:实现 src/lib/api.ts 暴露的全部端点(同名导出,签名一致)。
 * 语义逐一对齐 backend/app/routers/*(含 404/409/400 错误与审批状态机),
 * 数据操作落在 store 的内存状态上,写操作后持久化到 localStorage。
 */

import type {
  ApprovalDecision,
  ApprovalInboxItem,
  ApprovalStatus,
  AuthUser,
  BatchImportResponse,
  BatchImportResultItem,
  ChangeDiff,
  ChangeEvent,
  ChangeEventSummary,
  DashboardStats,
  DataTable,
  GraphNode,
  GraphResponse,
  HotTable,
  ImpactDetail,
  IntegrationSettings,
  IntegrationTestResult,
  LineageEdge,
  LoginResponse,
  ParseResult,
  Report,
  ReportListItem,
  SqlScript,
  SqlScriptDetail,
  System,
  SystemKind,
  TableDetail,
  TableLayer,
  TableListItem,
} from '@/lib/api'
import { getStoredAuth } from '@/lib/auth'
import {
  applyChange,
  columnsOf,
  createChangeEvent,
  ddlDiff,
  detectSqlType,
  engineParse,
  nextId,
  nowIso,
  persistParse,
  renderDdl,
  type MockState,
} from './engine'
import { BATCH_IMPORT_FILES, MOCK_AUTH_PASSWORD, SEED_AUTH_USERS } from './seed'
import { getState, persist } from './store'

// ---------------------------------------------------------------- 错误(与 ApiError 同构:status + message)

export class MockApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function fail(status: number, message: string): never {
  throw new MockApiError(status, message)
}

// ---------------------------------------------------------------- 通用辅助

function systemById(state: MockState, id: number | null | undefined): System | undefined {
  return id == null ? undefined : state.systems.find((s) => s.id === id)
}

function tableOut(state: MockState, table: DataTable): TableListItem {
  return {
    ...table,
    source_system_name: systemById(state, table.source_system_id)?.name ?? null,
    column_count: columnsOf(state, table.id).length,
  }
}

function reportOut(state: MockState, report: Report): ReportListItem {
  return {
    ...report,
    table_name: state.tables.find((t) => t.id === report.table_id)?.name ?? '',
    target_system_name: systemById(state, report.target_system_id)?.name ?? '',
  }
}

function scriptListItem(s: SqlScriptDetail): SqlScript {
  return {
    id: s.id,
    name: s.name,
    sql_type: s.sql_type,
    target_table: s.target_table,
    version: s.version,
    created_at: s.created_at,
    updated_at: s.updated_at,
  }
}

function nodeOut(state: MockState, table: DataTable, reportTableIds: Set<number>): GraphNode {
  return {
    id: table.id,
    name: table.name,
    layer: table.layer,
    source_system: systemById(state, table.source_system_id)?.name ?? null,
    owner: table.owner || '',
    is_report_source: reportTableIds.has(table.id),
  }
}

function edgeOut(state: MockState, edge: LineageEdge): GraphResponse['edges'][number] {
  return {
    id: edge.id,
    source: edge.src_table_id,
    target: edge.dst_table_id,
    script_name: state.scripts.find((s) => s.id === edge.script_id)?.name ?? null,
  }
}

function reportTableIds(state: MockState): Set<number> {
  return new Set(state.reports.map((r) => r.table_id))
}

/** 事件摘要:同时携带后端真实计数字段(impact_count/pending_tasks/approved_tasks)
 * 与 api.ts 声明字段(impacted_*_count/*_task_count),两种消费方式都可用。 */
type ChangeSummarySuperset = ChangeEventSummary & {
  impact_count: number
  pending_tasks: number
  approved_tasks: number
}

function eventSummary(state: MockState, event: ChangeEvent): ChangeSummarySuperset {
  const tasks = state.approvals.filter((a) => a.change_event_id === event.id)
  const uniqTargets = (type: string) =>
    new Set(tasks.filter((t) => t.target_type === type).map((t) => t.target_id)).size
  const impact = new Set(tasks.map((t) => `${t.target_type}:${t.target_id}`)).size
  const pending = tasks.filter((t) => t.status === 'pending').length
  const approved = tasks.filter((t) => t.status === 'approved').length
  const rejected = tasks.filter((t) => t.status === 'rejected').length
  return {
    ...event,
    impact_count: impact,
    pending_tasks: pending,
    approved_tasks: approved,
    impacted_report_count: uniqTargets('report'),
    impacted_system_count: uniqTargets('system'),
    impacted_table_count: uniqTargets('table'),
    pending_task_count: pending,
    approved_task_count: approved,
    rejected_task_count: rejected,
  }
}

/** 变更详情(由审批任务还原影响面,口径同后端 event_impact) */
function changeDetail(state: MockState, event: ChangeEvent): ImpactDetail {
  let diff: ChangeDiff = {}
  try {
    diff = JSON.parse(event.diff_summary || '{}') as ChangeDiff
  } catch {
    /* diff_summary 非 JSON 时给空 */
  }
  const approvals = state.approvals
    .filter((a) => a.change_event_id === event.id)
    .sort((a, b) => a.id - b.id)
  const impactedReports: ReportListItem[] = []
  const impactedSystems: System[] = []
  const impactedTables: DataTable[] = []
  for (const t of approvals) {
    if (t.target_type === 'report') {
      const rep = state.reports.find((r) => r.id === t.target_id)
      impactedReports.push(
        rep
          ? reportOut(state, rep)
          : ({
              id: t.target_id,
              name: t.target_name,
              table_id: 0,
              target_system_id: 0,
              owner: t.approver_name,
              owner_contact: '',
              schedule: '',
              description: '',
              table_name: '',
              target_system_name: '',
            } as ReportListItem),
      )
    } else if (t.target_type === 'system') {
      const sys = systemById(state, t.target_id)
      impactedSystems.push(
        sys ?? {
          id: t.target_id,
          name: t.target_name,
          kind: 'target' as SystemKind,
          owner: t.approver_name,
          contact: '',
          description: '',
        },
      )
    } else if (t.target_type === 'table') {
      const tbl = state.tables.find((x) => x.id === t.target_id)
      impactedTables.push(
        tbl ?? {
          id: t.target_id,
          name: t.target_name,
          layer: 'other' as TableLayer,
          source_system_id: null,
          owner: t.approver_name,
          description: '',
          created_at: event.created_at,
          updated_at: event.created_at,
        },
      )
    }
  }
  return {
    event,
    diff,
    impacted_reports: impactedReports,
    impacted_systems: impactedSystems,
    impacted_tables: impactedTables,
    approvals,
  }
}

// ---------------------------------------------------------------- 鉴权(对齐 backend/app/routers/auth.py)

/** mock token:`mock.{encodeURIComponent(username)}.{issued_at}`,有效期 24h(与后端 TTL 一致) */
const MOCK_TOKEN_TTL_MS = 24 * 3600 * 1000

function issueMockToken(username: string): string {
  return `mock.${encodeURIComponent(username)}.${Date.now()}`
}

export async function getAuthUsers(): Promise<AuthUser[]> {
  return SEED_AUTH_USERS.map((u) => ({ ...u }))
}

export async function login(payload: { username: string; password: string }): Promise<LoginResponse> {
  // 用户不存在与密码错误不区分(口径同后端)
  const user = SEED_AUTH_USERS.find((u) => u.name === payload.username)
  if (!user || payload.password !== MOCK_AUTH_PASSWORD) fail(401, '用户名或密码错误')
  return { token: issueMockToken(user.name), user: { ...user } }
}

export async function getMe(): Promise<AuthUser> {
  const token = getStoredAuth()?.token ?? ''
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== 'mock' || !parts[1] || !parts[2]) fail(401, '无效的 token')
  let username = ''
  try {
    username = decodeURIComponent(parts[1])
  } catch {
    fail(401, '无效的 token')
  }
  const user = SEED_AUTH_USERS.find((u) => u.name === username)
  if (!user) fail(401, '无效的 token')
  const issuedAt = Number(parts[2])
  if (!Number.isFinite(issuedAt)) fail(401, '无效的 token')
  if (Date.now() - issuedAt > MOCK_TOKEN_TTL_MS) fail(401, 'token 已过期')
  return { ...user }
}

// ---------------------------------------------------------------- 系统

export async function listSystems(): Promise<System[]> {
  return [...getState().systems].sort((a, b) => a.id - b.id)
}

export async function createSystem(payload: {
  name: string
  kind: SystemKind
  owner: string
  contact: string
  description: string
}): Promise<System> {
  const state = getState()
  if (state.systems.some((s) => s.name === payload.name)) {
    fail(409, `系统 ${payload.name} 已存在`)
  }
  const system: System = { id: nextId(state, 'system'), ...payload }
  state.systems.push(system)
  persist()
  return system
}

export async function updateSystem(id: number, payload: Partial<Omit<System, 'id'>>): Promise<System> {
  const state = getState()
  const system = systemById(state, id)
  if (!system) fail(404, '系统不存在')
  if (payload.name !== undefined && state.systems.some((s) => s.name === payload.name && s.id !== id)) {
    fail(409, `系统 ${payload.name} 已存在`)
  }
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) (system as unknown as Record<string, unknown>)[k] = v
  }
  persist()
  return system
}

export async function deleteSystem(id: number): Promise<void> {
  const state = getState()
  const system = systemById(state, id)
  if (!system) fail(404, '系统不存在')
  if (state.tables.some((t) => t.source_system_id === id)) {
    fail(409, '系统被数仓表引用,无法删除')
  }
  if (state.reports.some((r) => r.target_system_id === id)) {
    fail(409, '系统被报表引用,无法删除')
  }
  state.systems = state.systems.filter((s) => s.id !== id)
  persist()
}

// ---------------------------------------------------------------- 表

export async function listTables(params?: {
  keyword?: string
  layer?: TableLayer
  source_system_id?: number
}): Promise<TableListItem[]> {
  const state = getState()
  let tables = [...state.tables]
  const keyword = params?.keyword?.trim().toLowerCase()
  if (keyword) tables = tables.filter((t) => t.name.includes(keyword))
  if (params?.layer) tables = tables.filter((t) => t.layer === params.layer)
  if (params?.source_system_id !== undefined) {
    tables = tables.filter((t) => t.source_system_id === params.source_system_id)
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name)).map((t) => tableOut(state, t))
}

export async function getTable(id: number): Promise<TableDetail> {
  const state = getState()
  const table = state.tables.find((t) => t.id === id)
  if (!table) fail(404, '表不存在')
  return {
    ...tableOut(state, table),
    columns: columnsOf(state, table.id),
  }
}

export async function updateTable(
  id: number,
  payload: { source_system_id?: number | null; owner?: string; description?: string },
): Promise<DataTable> {
  const state = getState()
  const table = state.tables.find((t) => t.id === id)
  if (!table) fail(404, '表不存在')
  if ('source_system_id' in payload && payload.source_system_id != null && !systemById(state, payload.source_system_id)) {
    fail(400, 'source_system_id 指向的系统不存在')
  }
  if ('source_system_id' in payload) table.source_system_id = payload.source_system_id ?? null
  if (payload.owner !== undefined) table.owner = payload.owner
  if (payload.description !== undefined) table.description = payload.description
  table.updated_at = nowIso()
  persist()
  return tableOut(state, table)
}

// ---------------------------------------------------------------- 脚本与解析

export async function listScripts(): Promise<SqlScript[]> {
  return [...getState().scripts].sort((a, b) => a.id - b.id).map(scriptListItem)
}

export async function getScript(id: number): Promise<SqlScriptDetail> {
  const script = getState().scripts.find((s) => s.id === id)
  if (!script) fail(404, '脚本不存在')
  return { ...script }
}

export async function parseScript(payload: {
  name: string
  sql_text: string
  target_table?: string
}): Promise<ParseResult> {
  const state = getState()
  const result = engineParse(payload.sql_text, payload.target_table)
  const now = nowIso()
  const script: SqlScriptDetail = {
    id: nextId(state, 'script'),
    name: payload.name,
    sql_type: detectSqlType(result),
    sql_text: payload.sql_text,
    target_table: payload.target_table ?? null,
    version: 1,
    created_at: now,
    updated_at: now,
  }
  state.scripts.push(script)
  const info = persistParse(state, result, script)
  persist()
  return {
    script_id: script.id,
    target_tables: result.targets,
    source_tables: result.sources,
    tables_created: info.tables_created,
    edges_created: info.edges_created,
    warnings: result.warnings,
  }
}

export async function updateScript(id: number, payload: { sql_text: string }): Promise<ParseResult> {
  const state = getState()
  const script = state.scripts.find((s) => s.id === id)
  if (!script) fail(404, '脚本不存在')

  const oldSql = script.sql_text
  const result = engineParse(payload.sql_text, script.target_table ?? undefined)

  // 记录旧目标表(影响分析需要覆盖新旧两侧)
  const oldTargets = new Set(
    state.edges
      .filter((e) => e.script_id === script.id)
      .map((e) => state.tables.find((t) => t.id === e.dst_table_id)?.name)
      .filter((n): n is string => Boolean(n)),
  )

  script.sql_text = payload.sql_text
  script.sql_type = detectSqlType(result)
  script.version = (script.version || 1) + 1
  script.updated_at = nowIso()
  const syncInfo = persistParse(state, result, script)

  let changeEventId: number | null = null
  if (syncInfo.added.length > 0 || syncInfo.removed.length > 0) {
    // 血缘发生变化 -> 自动创建 sql_change 事件并生成审批任务
    const targetNames = new Set([...oldTargets, ...result.targets])
    const seedIds = state.tables.filter((t) => targetNames.has(t.name)).map((t) => t.id)
    const sortedAdded = [...syncInfo.added].sort()
    const sortedRemoved = [...syncInfo.removed].sort()
    const diff = {
      edges_added: sortedAdded.map(([source, target]) => ({ source, target })),
      edges_removed: sortedRemoved.map(([source, target]) => ({ source, target })),
    } as ChangeDiff
    const event = createChangeEvent(state, {
      change_type: 'sql_change',
      object_name: script.name,
      old_text: oldSql,
      new_text: payload.sql_text,
      diff,
      submitted_by: 'script_editor',
      seed_table_ids: seedIds,
    })
    changeEventId = event.id
  }

  persist()
  return {
    script_id: script.id,
    target_tables: result.targets,
    source_tables: result.sources,
    tables_created: [],
    edges_created: syncInfo.edges_created,
    warnings: result.warnings,
    change_event_id: changeEventId,
  }
}

export async function deleteScript(id: number): Promise<void> {
  const state = getState()
  const script = state.scripts.find((s) => s.id === id)
  if (!script) fail(404, '脚本不存在')
  state.edges = state.edges.filter((e) => e.script_id !== id)
  state.scripts = state.scripts.filter((s) => s.id !== id)
  persist()
}

/**
 * 批量导入(演示模式):浏览器内没有真实文件系统,任意 dir_path 都映射到
 * seed.BATCH_IMPORT_FILES 虚拟目录;每个文件真实走 engine 解析落库,
 * 同名脚本按更新处理(版本 +1、边增量同步,幂等)——口径同后端 _import_one_file。
 */
export async function batchImport(payload: { dir_path: string; recursive: boolean }): Promise<BatchImportResponse> {
  const raw = (payload.dir_path ?? '').trim()
  if (!raw) fail(404, '目录不存在或不是目录')
  const state = getState()
  const results: BatchImportResultItem[] = []
  for (const { file, sql_text } of BATCH_IMPORT_FILES) {
    // 脚本名 = 相对路径去 .sql 后缀(同后端)
    const name = file.replace(/\.sql$/i, '')
    const result = engineParse(sql_text)
    const now = nowIso()
    let script = state.scripts.find((s) => s.name === name)
    if (!script) {
      script = {
        id: nextId(state, 'script'),
        name,
        sql_type: detectSqlType(result),
        sql_text,
        target_table: null,
        version: 1,
        created_at: now,
        updated_at: now,
      }
      state.scripts.push(script)
    } else {
      script.sql_text = sql_text
      script.sql_type = detectSqlType(result)
      script.version = (script.version || 1) + 1
      script.updated_at = now
    }
    const info = persistParse(state, result, script)
    results.push({
      file,
      script_id: script.id,
      status: result.warnings.length > 0 ? 'warning' : 'ok',
      target_tables: result.targets,
      source_tables: result.sources,
      edges_created: info.edges_created,
      warnings: result.warnings,
      error: null,
    })
  }
  persist()
  return {
    summary: {
      total: results.length,
      ok: results.filter((r) => r.status === 'ok').length,
      warning: results.filter((r) => r.status === 'warning').length,
      error: results.filter((r) => r.status === 'error').length,
      edges_created: results.reduce((n, r) => n + r.edges_created, 0),
    },
    results,
  }
}

// ---------------------------------------------------------------- 报表

export async function listReports(): Promise<ReportListItem[]> {
  const state = getState()
  return [...state.reports].sort((a, b) => a.id - b.id).map((r) => reportOut(state, r))
}

function validateReportRefs(state: MockState, tableId: number, systemId: number): void {
  if (!state.tables.some((t) => t.id === tableId)) fail(400, 'table_id 指向的表不存在')
  if (!systemById(state, systemId)) fail(400, 'target_system_id 指向的系统不存在')
}

export async function createReport(payload: Omit<Report, 'id'>): Promise<Report> {
  const state = getState()
  validateReportRefs(state, payload.table_id, payload.target_system_id)
  const report: Report = { id: nextId(state, 'report'), ...payload }
  state.reports.push(report)
  persist()
  return reportOut(state, report)
}

export async function updateReport(id: number, payload: Partial<Omit<Report, 'id'>>): Promise<Report> {
  const state = getState()
  const report = state.reports.find((r) => r.id === id)
  if (!report) fail(404, '报表不存在')
  const tableId = payload.table_id ?? report.table_id
  const systemId = payload.target_system_id ?? report.target_system_id
  validateReportRefs(state, tableId, systemId)
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined) (report as unknown as Record<string, unknown>)[k] = v
  }
  persist()
  return reportOut(state, report)
}

export async function deleteReport(id: number): Promise<void> {
  const state = getState()
  const report = state.reports.find((r) => r.id === id)
  if (!report) fail(404, '报表不存在')
  state.reports = state.reports.filter((r) => r.id !== id)
  persist()
}

// ---------------------------------------------------------------- 血缘图

const OVERVIEW_NODE_LIMIT = 500

export async function getLineageOverview(): Promise<GraphResponse> {
  const state = getState()
  const tables = [...state.tables].sort((a, b) => a.id - b.id).slice(0, OVERVIEW_NODE_LIMIT)
  const tableIds = new Set(tables.map((t) => t.id))
  const reportIds = reportTableIds(state)
  return {
    nodes: tables.map((t) => nodeOut(state, t, reportIds)),
    edges: state.edges
      .filter((e) => tableIds.has(e.src_table_id) && tableIds.has(e.dst_table_id))
      .map((e) => edgeOut(state, e)),
  }
}

export async function getLineageGraph(params: {
  table_id: number
  direction?: 'upstream' | 'downstream' | 'both'
  depth?: number
}): Promise<GraphResponse> {
  const state = getState()
  const { table_id } = params
  // 兼容后端的 up/down 别名(api.ts 类型只暴露 upstream/downstream/both)
  const direction: string = params.direction ?? 'both'
  const depth = params.depth ?? 3
  const focus = state.tables.find((t) => t.id === table_id)
  if (!focus) fail(404, '表不存在')

  // 邻接表:up dst -> [src];down src -> [dst]
  const upAdj = new Map<number, number[]>()
  const downAdj = new Map<number, number[]>()
  for (const e of state.edges) {
    upAdj.set(e.dst_table_id, [...(upAdj.get(e.dst_table_id) ?? []), e.src_table_id])
    downAdj.set(e.src_table_id, [...(downAdj.get(e.src_table_id) ?? []), e.dst_table_id])
  }

  const distance = new Map<number, number>([[table_id, 0]])
  const bfs = (adj: Map<number, number[]>, sign: number) => {
    const queue: [number, number][] = [[table_id, 0]]
    while (queue.length > 0) {
      const [cur, d] = queue.shift() as [number, number]
      if (Math.abs(d) >= depth) continue
      for (const nxt of adj.get(cur) ?? []) {
        if (!distance.has(nxt)) {
          distance.set(nxt, d + sign)
          queue.push([nxt, d + sign])
        }
      }
    }
  }
  if (direction === 'up' || direction === 'upstream' || direction === 'both') bfs(upAdj, -1)
  if (direction === 'down' || direction === 'downstream' || direction === 'both') bfs(downAdj, 1)

  const tableIds = new Set(distance.keys())
  const reportIds = reportTableIds(state)
  const nodes: GraphNode[] = state.tables
    .filter((t) => tableIds.has(t.id))
    .sort((a, b) => a.id - b.id)
    .map((t) => ({ ...nodeOut(state, t, reportIds), focus: t.id === table_id, distance: distance.get(t.id) }))
  const edges = state.edges
    .filter((e) => tableIds.has(e.src_table_id) && tableIds.has(e.dst_table_id))
    .map((e) => edgeOut(state, e))
  return { nodes, edges }
}

// ---------------------------------------------------------------- 变更与审批

export async function submitDdlChange(payload: {
  table_id: number
  new_ddl: string
  submitted_by: string
}): Promise<ChangeEvent> {
  const state = getState()
  const table = state.tables.find((t) => t.id === payload.table_id)
  if (!table) fail(404, '表不存在')
  const result = engineParse(payload.new_ddl)
  if (Object.keys(result.columnsByTable).length === 0 && result.alters.length === 0) {
    fail(400, '无法从 new_ddl 解析出字段定义或 ALTER 操作')
  }
  const diff = ddlDiff(state, table, result)
  const event = createChangeEvent(state, {
    change_type: 'ddl_change',
    object_name: table.name,
    old_text: renderDdl(state, table),
    new_text: payload.new_ddl,
    diff,
    submitted_by: payload.submitted_by,
    seed_table_ids: [table.id],
  })
  persist()
  // 与后端一致:返回完整变更详情(前端按真实契约收窄)
  return changeDetail(state, event) as unknown as ChangeEvent
}

export async function submitSqlChange(payload: {
  script_id: number
  new_sql: string
  submitted_by: string
}): Promise<ChangeEvent> {
  const state = getState()
  const script = state.scripts.find((s) => s.id === payload.script_id)
  if (!script) fail(404, '脚本不存在')

  const tableName = (id: number) => state.tables.find((t) => t.id === id)?.name ?? ''
  const oldPairs = new Set(
    state.edges
      .filter((e) => e.script_id === script.id)
      .map((e) => `${tableName(e.src_table_id)}|${tableName(e.dst_table_id)}`),
  )
  const result = engineParse(payload.new_sql, script.target_table ?? undefined)
  const newPairs = new Set(
    result.edges.flatMap((edge) => edge.sources.map((src) => `${src}|${edge.target}`)),
  )
  const added = [...newPairs].filter((p) => !oldPairs.has(p) && !p.startsWith('|') && !p.endsWith('|')).sort()
  const removed = [...oldPairs].filter((p) => !newPairs.has(p) && !p.startsWith('|') && !p.endsWith('|')).sort()
  const diff = {
    edges_added: added.map((p) => {
      const [source, target] = p.split('|')
      return { source, target }
    }),
    edges_removed: removed.map((p) => {
      const [source, target] = p.split('|')
      return { source, target }
    }),
  } as ChangeDiff

  // 影响分析覆盖新旧两侧目标表
  const oldTargetNames = new Set([...oldPairs].map((p) => p.split('|')[1]).filter(Boolean))
  const targetNames = new Set([...oldTargetNames, ...result.targets])
  const seedIds = state.tables.filter((t) => targetNames.has(t.name)).map((t) => t.id)

  const event = createChangeEvent(state, {
    change_type: 'sql_change',
    object_name: script.name,
    old_text: script.sql_text,
    new_text: payload.new_sql,
    diff,
    submitted_by: payload.submitted_by,
    seed_table_ids: seedIds,
  })
  persist()
  return changeDetail(state, event) as unknown as ChangeEvent
}

/** 新建表变更申请(CREATE TABLE / CTAS):只创建 pending 事件,审批通过后才入图 */
export async function submitCreateTableChange(payload: {
  new_ddl: string
  submitted_by: string
}): Promise<ChangeEvent> {
  const state = getState()
  const result = engineParse(payload.new_ddl)
  // 新表名:优先全量 CREATE 定义,其次 CTAS 目标表
  let name = Object.keys(result.columnsByTable)[0] ?? ''
  if (!name) {
    const ctas = result.edges.find((e) => e.target)
    if (ctas) name = ctas.target
  }
  if (!name) fail(400, '无法解析出新表(需要 CREATE TABLE 或 CREATE TABLE ... AS SELECT)')
  if (state.tables.some((t) => t.name === name)) fail(409, `表 ${name} 已存在`)

  const cols = result.columnsByTable[name] ?? []
  const diff = {
    added: cols.map((c) => ({ name: c.name, data_type: c.data_type, comment: c.comment })),
    removed: [],
    type_changed: [],
    edges_added: result.edges
      .filter((e) => e.target === name)
      .flatMap((e) => e.sources.map((s) => ({ source: s, target: name }))),
  } as unknown as ChangeDiff

  // 影响分析:来源表及其下游都会被「新消费者」波及;来源表 owner 参与审批
  const srcTables = state.tables.filter((t) => result.sources.includes(t.name))
  const event = createChangeEvent(state, {
    change_type: 'create_table',
    object_name: name,
    old_text: '',
    new_text: payload.new_ddl,
    diff,
    submitted_by: payload.submitted_by,
    seed_table_ids: srcTables.map((t) => t.id),
    extra_tasks: srcTables.map((t) => ({
      approver_name: t.owner || '未设置',
      approver_role: 'table_owner',
      target_type: 'table',
      target_id: t.id,
      target_name: t.name,
    })),
  })
  ensureApprovable(state, event, payload.submitted_by, name)
  persist()
  return changeDetail(state, event) as unknown as ChangeEvent
}

/** 删除表变更申请(DROP TABLE):diff 为字段移除 + 关联血缘边移除;审批通过后才真正删除 */
export async function submitDropTableChange(payload: {
  table_id: number
  submitted_by: string
}): Promise<ChangeEvent> {
  const state = getState()
  const table = state.tables.find((t) => t.id === payload.table_id)
  if (!table) fail(404, '表不存在')

  const tableName = (id: number) => state.tables.find((t) => t.id === id)?.name ?? ''
  const incident = state.edges.filter(
    (e) => e.src_table_id === table.id || e.dst_table_id === table.id,
  )
  const diff = {
    added: [],
    removed: columnsOf(state, table.id).map((c) => ({
      name: c.name,
      data_type: c.data_type,
      comment: c.comment,
    })),
    type_changed: [],
    edges_removed: incident.map((e) => ({
      source: tableName(e.src_table_id),
      target: tableName(e.dst_table_id),
    })),
  } as unknown as ChangeDiff

  // 影响分析:被删表的全部下游(表/报表/系统)都受影响;表 owner 本人也参与审批
  const event = createChangeEvent(state, {
    change_type: 'drop_table',
    object_name: table.name,
    old_text: renderDdl(state, table),
    new_text: `DROP TABLE ${table.name};`,
    diff,
    submitted_by: payload.submitted_by,
    seed_table_ids: [table.id],
    // 表有 owner 时才加 owner 任务;无 owner 时由兜底逻辑交给提交人自审,避免任务卡死
    extra_tasks: table.owner
      ? [
          {
            approver_name: table.owner,
            approver_role: 'table_owner' as const,
            target_type: 'table' as const,
            target_id: table.id,
            target_name: table.name,
          },
        ]
      : [],
  })
  ensureApprovable(state, event, payload.submitted_by, table.name)
  persist()
  return changeDetail(state, event) as unknown as ChangeEvent
}

/** 零审批任务兜底:无任何受影响方时,由提交人自审,保证事件可闭环生效 */
function ensureApprovable(state: MockState, event: ChangeEvent, submittedBy: string, objectName: string): void {
  if (state.approvals.some((a) => a.change_event_id === event.id)) return
  state.approvals.push({
    id: nextId(state, 'approval'),
    change_event_id: event.id,
    approver_name: submittedBy || '未设置',
    approver_role: 'table_owner',
    target_type: 'table',
    target_id: 0,
    target_name: objectName,
    status: 'pending',
    comment: null,
    decided_at: null,
  })
}

export async function listChanges(): Promise<ChangeEventSummary[]> {
  const state = getState()
  return [...state.changes]
    .sort((a, b) => (a.created_at === b.created_at ? b.id - a.id : a.created_at < b.created_at ? 1 : -1))
    .map((e) => eventSummary(state, e))
}

export async function getChange(id: number): Promise<ImpactDetail> {
  const state = getState()
  const event = state.changes.find((c) => c.id === id)
  if (!event) fail(404, '变更事件不存在')
  return changeDetail(state, event)
}

export async function listApprovals(params?: {
  status?: ApprovalStatus
  approver?: string
}): Promise<ApprovalInboxItem[]> {
  const state = getState()
  let tasks = [...state.approvals]
  if (params?.status) tasks = tasks.filter((t) => t.status === params.status)
  if (params?.approver) tasks = tasks.filter((t) => t.approver_name === params.approver)
  return tasks.sort((a, b) => a.id - b.id).map((t) => {
    const event = state.changes.find((c) => c.id === t.change_event_id)
    const summary: ChangeSummarySuperset = event
      ? eventSummary(state, event)
      : {
          // 兜底:任务的事件被删除时(正常不会发生)给最小可用摘要
          id: t.change_event_id,
          change_type: 'ddl_change',
          object_name: '',
          old_text: '',
          new_text: '',
          diff_summary: '{}',
          status: 'pending',
          submitted_by: '',
          created_at: t.decided_at ?? '',
          resolved_at: null,
          impact_count: 0,
          pending_tasks: 0,
          approved_tasks: 0,
          impacted_report_count: 0,
          impacted_system_count: 0,
          impacted_table_count: 0,
          pending_task_count: 0,
          approved_task_count: 0,
          rejected_task_count: 0,
        }
    return { ...t, change_event: summary }
  })
}

export async function decideApproval(
  id: number,
  payload: { decision: ApprovalDecision; comment?: string },
): Promise<ChangeEvent> {
  const state = getState()
  const task = state.approvals.find((a) => a.id === id)
  if (!task) fail(404, '审批任务不存在')
  if (payload.decision !== 'approved' && payload.decision !== 'rejected') {
    fail(400, 'decision 必须是 approved 或 rejected')
  }
  if (task.status !== 'pending') fail(409, '该任务已决策')

  task.status = payload.decision
  task.comment = payload.comment ?? null
  task.decided_at = nowIso()

  const event = state.changes.find((c) => c.id === task.change_event_id)
  if (event && event.status === 'pending') {
    if (payload.decision === 'rejected') {
      event.status = 'rejected'
      event.resolved_at = nowIso()
    } else {
      const siblings = state.approvals.filter((a) => a.change_event_id === event.id)
      if (siblings.every((t) => t.status === 'approved')) {
        event.status = 'approved'
        event.resolved_at = nowIso()
        applyChange(state, event)
      }
    }
  }
  persist()
  if (!event) fail(404, '变更事件不存在')
  return event
}

// ---------------------------------------------------------------- 集成设置(对齐 backend /settings/integrations)

/** 输出时剥离密钥明文,只回 *_set 标记(与后端契约一致) */
function integrationSettingsOut(state: MockState): IntegrationSettings {
  const s = state.integrationSettings
  return {
    ado: { ...s.ado, pat: undefined, webhook_secret: undefined },
    smtp: { ...s.smtp, password: undefined },
    emails: s.emails.map((e) => ({ ...e })),
  }
}

export async function getIntegrationSettings(): Promise<IntegrationSettings> {
  return integrationSettingsOut(getState())
}

/** 更新集成设置:pat/password/webhook_secret 传空串(或未传)保持原值 */
export async function updateIntegrationSettings(payload: IntegrationSettings): Promise<IntegrationSettings> {
  const state = getState()
  const cur = state.integrationSettings

  const ado = { ...cur.ado }
  ado.enabled = Boolean(payload.ado?.enabled)
  ado.org_url = (payload.ado?.org_url ?? '').trim()
  ado.project = (payload.ado?.project ?? '').trim()
  ado.repo = (payload.ado?.repo ?? '').trim()
  if (payload.ado?.pat) {
    ado.pat = payload.ado.pat
    ado.pat_set = true
  }
  if (payload.ado?.webhook_secret) {
    ado.webhook_secret = payload.ado.webhook_secret
    ado.webhook_secret_set = true
  }

  const smtp = { ...cur.smtp }
  smtp.enabled = Boolean(payload.smtp?.enabled)
  smtp.host = (payload.smtp?.host ?? '').trim()
  const port = Number(payload.smtp?.port)
  smtp.port = Number.isFinite(port) && port > 0 ? Math.floor(port) : 465
  smtp.username = (payload.smtp?.username ?? '').trim()
  if (payload.smtp?.password) {
    smtp.password = payload.smtp.password
    smtp.password_set = true
  }
  smtp.from_addr = (payload.smtp?.from_addr ?? '').trim()
  smtp.use_tls = Boolean(payload.smtp?.use_tls)

  const known = new Set(cur.emails.map((e) => e.name))
  const emails = Array.isArray(payload.emails)
    ? payload.emails
        .filter((e) => e && known.has(e.name))
        .map((e) => ({ name: e.name, email: (e.email ?? '').trim() }))
    : cur.emails

  state.integrationSettings = { ado, smtp, emails }
  persist()
  return integrationSettingsOut(state)
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function testSmtp(to: string): Promise<IntegrationTestResult> {
  const target = (to ?? '').trim()
  if (!EMAIL_RE.test(target)) fail(400, '收件邮箱格式不正确')
  return { ok: true, detail: '演示模式:已模拟发送测试邮件' }
}

export async function testAdo(): Promise<IntegrationTestResult> {
  const ado = getState().integrationSettings.ado
  if (!ado.org_url.trim()) fail(400, '请先填写并保存 ADO 组织 URL')
  return { ok: true, detail: '演示模式:已模拟连接 ADO 仓库' }
}

// ---------------------------------------------------------------- 仪表盘

function downstreamCount(state: MockState, start: number): { count: number; reached: Set<number> } {
  const adj = new Map<number, number[]>()
  for (const e of state.edges) {
    adj.set(e.src_table_id, [...(adj.get(e.src_table_id) ?? []), e.dst_table_id])
  }
  const visited = new Set<number>([start])
  const queue = [start]
  let n = 0
  while (queue.length > 0) {
    const cur = queue.shift() as number
    for (const nxt of adj.get(cur) ?? []) {
      if (!visited.has(nxt)) {
        visited.add(nxt)
        n++
        queue.push(nxt)
      }
    }
  }
  visited.delete(start)
  return { count: n, reached: visited }
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const state = getState()
  const pendingChanges = state.changes.filter((c) => c.status === 'pending').length
  const pendingApprovals = state.approvals.filter((a) => a.status === 'pending').length

  const layerCounts = new Map<string, number>()
  for (const t of state.tables) layerCounts.set(t.layer, (layerCounts.get(t.layer) ?? 0) + 1)
  const layerDistribution = [...layerCounts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([layer, count]) => ({ layer: layer as TableLayer, count }))

  const recentChanges = [...state.changes]
    .sort((a, b) => (a.created_at === b.created_at ? b.id - a.id : a.created_at < b.created_at ? 1 : -1))
    .slice(0, 5)
    .map((e) => eventSummary(state, e))

  // 热门表:下游可达表数量 Top5(附带下游报表计数)
  let hot: HotTable[] = state.tables.map((t) => {
    const { count, reached } = downstreamCount(state, t.id)
    const downstreamReports = state.reports.filter((r) => reached.has(r.table_id)).length
    return { name: t.name, downstream: count, layer: t.layer, owner: t.owner || undefined, downstream_reports: downstreamReports }
  })
  hot = hot.sort((a, b) => (b.downstream !== a.downstream ? b.downstream - a.downstream : a.name.localeCompare(b.name))).slice(0, 5)
  const nonZero = hot.filter((h) => h.downstream > 0)
  const hotTables = nonZero.length > 0 ? nonZero : hot

  return {
    table_count: state.tables.length,
    report_count: state.reports.length,
    system_count: state.systems.length,
    edge_count: state.edges.length,
    pending_changes: pendingChanges,
    pending_approvals: pendingApprovals,
    layer_distribution: layerDistribution,
    recent_changes: recentChanges,
    hot_tables: hotTables,
  }
}
