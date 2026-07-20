/**
 * LineageHub 前端 API 客户端
 * 与 architecture.md 第 2 节 REST API 契约逐一对应。
 * 全部走相对路径 /api/...,开发期由 vite proxy 转发到后端。
 *
 * 演示模式:线上预览等后端不可达(网络错误 / 5xx / 非 JSON 响应)时,
 * 每个端点自动降级到 src/lib/mock 的浏览器内置模拟 API,全页面可用;
 * 4xx(404/409 等业务错误)不降级,按原逻辑抛 ApiError。
 */

import { toast } from '@/components/common/Toast'
import { clearStoredAuth, getStoredAuth } from './auth'
import * as mock from './mock/handlers'

// ---------- 类型(与 architecture.md 第 1 节数据模型对应) ----------

/** 业务系统(既可作数据来源,也可作报表目标) */
export type SystemKind = 'source' | 'target' | 'both'

export interface System {
  id: number
  name: string
  kind: SystemKind
  owner: string
  contact: string
  description: string
}

/** 数仓分层 */
export type TableLayer = 'ods' | 'dim' | 'dwd' | 'dws' | 'ads' | 'other'

/** 数仓表 */
export interface DataTable {
  id: number
  name: string
  layer: TableLayer
  source_system_id: number | null
  owner: string
  description: string
  created_at: string
  updated_at: string
}

/** 表列表项(含冗余展示字段) */
export interface TableListItem extends DataTable {
  source_system_name: string | null
  column_count: number
}

/** 表字段 */
export interface TableColumn {
  id: number
  table_id: number
  name: string
  data_type: string
  comment: string | null
  ordinal: number
}

/** 表详情 */
export interface TableDetail extends DataTable {
  columns: TableColumn[]
}

/** SQL 脚本 */
export type SqlType = 'ddl' | 'etl'

export interface SqlScript {
  id: number
  name: string
  sql_type: SqlType
  target_table: string | null
  version: number
  created_at: string
  updated_at: string
}

export interface SqlScriptDetail extends SqlScript {
  sql_text: string
}

/** 血缘边 */
export interface LineageEdge {
  id: number
  src_table_id: number
  dst_table_id: number
  script_id: number | null
  column_mapping: string
  created_at: string
}

/** 报表 */
export interface Report {
  id: number
  name: string
  table_id: number
  target_system_id: number
  owner: string
  owner_contact: string
  schedule: string
  description: string
}

export interface ReportListItem extends Report {
  table_name: string
  target_system_name: string
}

/** 变更事件 */
export type ChangeType = 'ddl_change' | 'sql_change'
export type ChangeStatus = 'pending' | 'approved' | 'rejected'

export interface ChangeEvent {
  id: number
  change_type: ChangeType
  object_name: string
  old_text: string
  new_text: string
  diff_summary: string
  status: ChangeStatus
  submitted_by: string
  created_at: string
  resolved_at: string | null
}

/** 变更事件摘要(列表用,含影响与任务计数) */
export interface ChangeEventSummary extends ChangeEvent {
  impacted_report_count: number
  impacted_system_count: number
  impacted_table_count: number
  pending_task_count: number
  approved_task_count: number
  rejected_task_count: number
}

/** 审批任务 */
export type ApproverRole = 'report_owner' | 'system_owner' | 'table_owner'
export type ApprovalTargetType = 'report' | 'system' | 'table'
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'
export type ApprovalDecision = 'approved' | 'rejected'

export interface ApprovalTask {
  id: number
  change_event_id: number
  approver_name: string
  approver_role: ApproverRole
  target_type: ApprovalTargetType
  target_id: number
  target_name: string
  status: ApprovalStatus
  comment: string | null
  decided_at: string | null
}

/** 审批收件箱条目(附变更事件摘要) */
export interface ApprovalInboxItem extends ApprovalTask {
  change_event: ChangeEventSummary
}

/** 血缘图 */
export interface GraphNode {
  id: number
  name: string
  layer: TableLayer
  source_system: string | null
  owner: string
  is_report_source: boolean
  /** 仅 /lineage/graph 返回:相对焦点距离,上游为负/下游为正 */
  distance?: number
  /** 仅 /lineage/graph 返回:是否焦点表 */
  focus?: boolean
}

export interface GraphEdge {
  id: number
  source: number
  target: number
  script_name: string | null
}

export interface GraphResponse {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

/** 解析结果(POST /scripts/parse、PUT /scripts/{id}) */
export interface ParseResult {
  script_id: number
  target_tables: string[]
  source_tables: string[]
  tables_created: string[]
  edges_created: number
  warnings: string[]
  /** 仅 PUT /scripts/{id} 可能返回:血缘变化自动创建的变更事件 */
  change_event_id?: number | null
}

/** 列级 diff(变更详情) */
export interface ColumnDiffEntry {
  name: string
  old_type?: string
  new_type?: string
}

export interface ChangeDiff {
  added?: ColumnDiffEntry[]
  removed?: ColumnDiffEntry[]
  type_changed?: ColumnDiffEntry[]
  edges_added?: { source: string; target: string }[]
  edges_removed?: { source: string; target: string }[]
}

/** 变更事件详情(GET /changes/{id}) */
export interface ImpactDetail {
  event: ChangeEvent
  diff: ChangeDiff
  impacted_reports: ReportListItem[]
  impacted_systems: System[]
  impacted_tables: DataTable[]
  approvals: ApprovalTask[]
}

/** 鉴权用户(GET /auth/users、POST /auth/login、GET /auth/me) */
export interface AuthUser {
  name: string
  role: string
}

/** 登录响应(POST /auth/login) */
export interface LoginResponse {
  token: string
  user: AuthUser
}

/** 批量导入单文件结果状态(POST /scripts/batch-import) */
export type BatchImportStatus = 'ok' | 'warning' | 'error'

export interface BatchImportResultItem {
  file: string
  script_id: number | null
  status: BatchImportStatus
  target_tables: string[]
  source_tables: string[]
  edges_created: number
  warnings: string[]
  error: string | null
}

export interface BatchImportSummary {
  total: number
  ok: number
  warning: number
  error: number
  edges_created: number
}

export interface BatchImportResponse {
  summary: BatchImportSummary
  results: BatchImportResultItem[]
}

/** 仪表盘统计(GET /dashboard/stats) */
export interface LayerDistribution {
  layer: TableLayer
  count: number
}

export interface HotTable {
  name: string
  downstream: number
  layer?: TableLayer
  owner?: string
  downstream_reports?: number
}

export interface DashboardStats {
  table_count: number
  report_count: number
  system_count: number
  edge_count: number
  pending_changes: number
  pending_approvals: number
  layer_distribution: LayerDistribution[]
  recent_changes: ChangeEventSummary[]
  hot_tables: HotTable[]
}

// ---------- 请求基础 ----------

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

type QueryValue = string | number | boolean | null | undefined

function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `/api${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    params.set(key, String(value))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

async function request<T>(
  path: string,
  options: {
    method?: string
    query?: Record<string, QueryValue>
    body?: unknown
  } = {},
): Promise<T> {
  const { method = 'GET', query, body } = options
  // 已登录请求自动携带 Bearer token(localStorage lineagehub-auth)
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getStoredAuth()?.token
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(buildUrl(path, query), {
    method,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    let message = `请求失败(${res.status})`
    try {
      const data = await res.json()
      if (typeof data?.detail === 'string') message = data.detail
    } catch {
      // 忽略非 JSON 错误体
    }
    throw new ApiError(res.status, message)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// ---------- 演示模式(API 不可达时自动降级到浏览器内置模拟 API) ----------

export type DemoModeListener = (active: boolean) => void

let demoMode = false
let demoModeNoticed = false
const demoModeListeners = new Set<DemoModeListener>()

/** 当前是否处于浏览器内置演示模式 */
export function isDemoMode(): boolean {
  return demoMode
}

/** 演示模式订阅集合(Layout 等 UI 订阅,add/delete 监听器) */
export function getDemoModeListeners(): Set<DemoModeListener> {
  return demoModeListeners
}

/** 通知所有订阅者演示模式状态发生变化 */
export function notifyDemoMode(): void {
  for (const fn of [...demoModeListeners]) fn(demoMode)
}

/** 首次降级时进入演示模式:console.warn 一次 + Toast 提示一次 + 通知订阅者 */
function enterDemoMode(): void {
  if (demoMode) return
  demoMode = true
  if (!demoModeNoticed) {
    demoModeNoticed = true
    console.warn('[LineageHub] 后端 API 不可达,已切换到浏览器内置演示模式')
    try {
      toast.info('后端 API 不可达,已切换到内置演示模式')
    } catch {
      /* Toaster 未挂载等场景下静默 */
    }
  }
  notifyDemoMode()
}

/**
 * 端点降级包装:优先真实 fetch;5xx / 网络错误 / 非 JSON 响应时进入演示模式并转调 mock 同名实现;
 * 4xx 业务错误不降级,原样抛出 ApiError。进入演示模式后后续调用直接走 mock。
 */
async function withFallback<T>(real: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
  if (demoMode) return fallback()
  try {
    return await real()
  } catch (err) {
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) throw err
    enterDemoMode()
    return fallback()
  }
}

// ---------- 鉴权 ----------

export const getAuthUsers = () =>
  withFallback(() => request<AuthUser[]>('/auth/users'), mock.getAuthUsers)

export const login = (payload: { username: string; password: string }) =>
  withFallback(
    () => request<LoginResponse>('/auth/login', { method: 'POST', body: payload }),
    () => mock.login(payload),
  )

/** 当前登录用户;401(token 无效/过期)时清除本地登录态后再抛出 */
export const getMe = () =>
  withFallback(
    () =>
      request<AuthUser>('/auth/me').catch((err) => {
        if (err instanceof ApiError && err.status === 401) clearStoredAuth()
        throw err
      }),
    () =>
      mock.getMe().catch((err) => {
        if (err instanceof mock.MockApiError && err.status === 401) clearStoredAuth()
        throw err
      }),
  )

// ---------- 系统 ----------

export const listSystems = () => withFallback(() => request<System[]>('/systems'), mock.listSystems)

export const createSystem = (payload: {
  name: string
  kind: SystemKind
  owner: string
  contact: string
  description: string
}) =>
  withFallback(
    () => request<System>('/systems', { method: 'POST', body: payload }),
    () => mock.createSystem(payload),
  )

export const updateSystem = (id: number, payload: Partial<Omit<System, 'id'>>) =>
  withFallback(
    () => request<System>(`/systems/${id}`, { method: 'PUT', body: payload }),
    () => mock.updateSystem(id, payload),
  )

export const deleteSystem = (id: number) =>
  withFallback(
    () => request<void>(`/systems/${id}`, { method: 'DELETE' }),
    () => mock.deleteSystem(id),
  )

// ---------- 表 ----------

export const listTables = (params?: {
  keyword?: string
  layer?: TableLayer
  source_system_id?: number
}) =>
  withFallback(
    () => request<TableListItem[]>('/tables', { query: { ...params } }),
    () => mock.listTables(params),
  )

export const getTable = (id: number) =>
  withFallback(
    () => request<TableDetail>(`/tables/${id}`),
    () => mock.getTable(id),
  )

export const updateTable = (
  id: number,
  payload: { source_system_id?: number | null; owner?: string; description?: string },
) =>
  withFallback(
    () => request<DataTable>(`/tables/${id}`, { method: 'PUT', body: payload }),
    () => mock.updateTable(id, payload),
  )

// ---------- 脚本与解析 ----------

export const listScripts = () => withFallback(() => request<SqlScript[]>('/scripts'), mock.listScripts)

export const getScript = (id: number) =>
  withFallback(
    () => request<SqlScriptDetail>(`/scripts/${id}`),
    () => mock.getScript(id),
  )

export const parseScript = (payload: {
  name: string
  sql_text: string
  target_table?: string
}) =>
  withFallback(
    () => request<ParseResult>('/scripts/parse', { method: 'POST', body: payload }),
    () => mock.parseScript(payload),
  )

export const updateScript = (id: number, payload: { sql_text: string }) =>
  withFallback(
    () => request<ParseResult>(`/scripts/${id}`, { method: 'PUT', body: payload }),
    () => mock.updateScript(id, payload),
  )

export const deleteScript = (id: number) =>
  withFallback(
    () => request<void>(`/scripts/${id}`, { method: 'DELETE' }),
    () => mock.deleteScript(id),
  )

/** 批量导入目录下的 .sql 文件(逐文件解析落库,幂等;目录不存在 404) */
export const batchImport = (payload: { dir_path: string; recursive: boolean }) =>
  withFallback(
    () => request<BatchImportResponse>('/scripts/batch-import', { method: 'POST', body: payload }),
    () => mock.batchImport(payload),
  )

// ---------- 报表 ----------

export const listReports = () => withFallback(() => request<ReportListItem[]>('/reports'), mock.listReports)

export const createReport = (payload: Omit<Report, 'id'>) =>
  withFallback(
    () => request<Report>('/reports', { method: 'POST', body: payload }),
    () => mock.createReport(payload),
  )

export const updateReport = (id: number, payload: Partial<Omit<Report, 'id'>>) =>
  withFallback(
    () => request<Report>(`/reports/${id}`, { method: 'PUT', body: payload }),
    () => mock.updateReport(id, payload),
  )

export const deleteReport = (id: number) =>
  withFallback(
    () => request<void>(`/reports/${id}`, { method: 'DELETE' }),
    () => mock.deleteReport(id),
  )

// ---------- 血缘图 ----------

export const getLineageOverview = () =>
  withFallback(() => request<GraphResponse>('/lineage/overview'), mock.getLineageOverview)

export const getLineageGraph = (params: {
  table_id: number
  direction?: 'upstream' | 'downstream' | 'both'
  depth?: number
}) =>
  withFallback(
    () =>
      request<GraphResponse>('/lineage/graph', {
        query: { direction: 'both', depth: 3, ...params },
      }),
    () => mock.getLineageGraph(params),
  )

// ---------- 变更与审批 ----------

export const submitDdlChange = (payload: {
  table_id: number
  new_ddl: string
  submitted_by: string
}) =>
  withFallback(
    () => request<ChangeEvent>('/changes/ddl', { method: 'POST', body: payload }),
    () => mock.submitDdlChange(payload),
  )

export const submitSqlChange = (payload: {
  script_id: number
  new_sql: string
  submitted_by: string
}) =>
  withFallback(
    () => request<ChangeEvent>('/changes/sql', { method: 'POST', body: payload }),
    () => mock.submitSqlChange(payload),
  )

export const listChanges = () => withFallback(() => request<ChangeEventSummary[]>('/changes'), mock.listChanges)

export const getChange = (id: number) =>
  withFallback(
    () => request<ImpactDetail>(`/changes/${id}`),
    () => mock.getChange(id),
  )

export const listApprovals = (params?: { status?: ApprovalStatus; approver?: string }) =>
  withFallback(
    () => request<ApprovalInboxItem[]>('/approvals', { query: { ...params } }),
    () => mock.listApprovals(params),
  )

export const decideApproval = (
  id: number,
  payload: { decision: ApprovalDecision; comment?: string },
) =>
  withFallback(
    () => request<ChangeEvent>(`/approvals/${id}/decision`, { method: 'POST', body: payload }),
    () => mock.decideApproval(id, payload),
  )

// ---------- 仪表盘 ----------

export const getDashboardStats = () =>
  withFallback(() => request<DashboardStats>('/dashboard/stats'), mock.getDashboardStats)
