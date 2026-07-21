/**
 * 演示模式解析与落库引擎(浏览器内的 backend/app/lineage + service.py 等价物)。
 *
 * 表级血缘(targets/sources/语句类型)复用本地 best-effort 解析器
 * src/components/sql/parsePreview.ts;CREATE TABLE 字段清单与 ALTER 增量操作
 * 由本模块的轻量 DDL 解析补齐,够支撑字段注册与 diff。
 * 落库语义对齐 backend/app/service.py:幂等去重、增量同步边、影响分析 BFS。
 */

import { layerOf, parseSqlLocally, type ColumnMapping } from '@/components/sql/parsePreview'
import type {
  ApprovalTask,
  ChangeDiff,
  ChangeEvent,
  DataTable,
  LineageEdge,
  Report,
  SqlScript,
  SqlType,
  System,
  TableColumn,
} from '@/lib/api'

// ---------------------------------------------------------------- 状态形状(store.ts 持久化)

export interface MockSeq {
  system: number
  table: number
  column: number
  script: number
  edge: number
  report: number
  change: number
  approval: number
}

export interface MockState {
  systems: System[]
  tables: DataTable[]
  columns: TableColumn[]
  scripts: (SqlScript & { sql_text: string })[]
  edges: LineageEdge[]
  reports: Report[]
  changes: ChangeEvent[]
  approvals: ApprovalTask[]
  seq: MockSeq
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function nextId(state: MockState, key: keyof MockSeq): number {
  const id = state.seq[key]
  state.seq[key] = id + 1
  return id
}

// ---------------------------------------------------------------- DDL 字段解析(best-effort)

export interface ParsedColumn {
  name: string
  data_type: string
  comment: string | null
}

export interface AlterOp {
  table: string
  op: 'add' | 'drop' | 'change'
  old_name?: string
  column?: ParsedColumn
}

/** 字符串感知的顶层逗号拆分(类型里可能含 DECIMAL(12,2)、注释里可能含逗号) */
function splitTopLevel(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (c === "'") {
        if (text[i + 1] === "'") i++
        else inStr = false
      }
      continue
    }
    if (c === "'") inStr = true
    else if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    else if (c === ',' && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/** 在字符串外找 COMMENT 'xxx' 子句,返回其起始位置与解析出的字符串值 */
function findCommentClause(text: string): { index: number; value: string } | null {
  let inStr = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (c === "'") {
        if (text[i + 1] === "'") i++
        else inStr = false
      }
      continue
    }
    if (c === "'") {
      inStr = true
      continue
    }
    if (c === '(') {
      // 跳过括号体(类型参数内不可能有 COMMENT)
      let depth = 1
      i++
      while (i < text.length && depth > 0) {
        if (text[i] === '(') depth++
        else if (text[i] === ')') depth--
        i++
      }
      i--
      continue
    }
    const m = /^comment\s*'/i.exec(text.slice(i))
    if (m) {
      // 解析字符串字面量('' 转义)
      let j = i + m[0].length
      let value = ''
      while (j < text.length) {
        if (text[j] === "'") {
          if (text[j + 1] === "'") {
            value += "'"
            j += 2
            continue
          }
          break
        }
        value += text[j]
        j++
      }
      return { index: i, value }
    }
  }
  return null
}

const COLUMN_SKIP_KEYWORDS = new Set(['primary', 'constraint', 'foreign', 'unique', 'key'])

/** 解析单列定义 `name TYPE [COMMENT '...']` */
function parseColumnItem(item: string): ParsedColumn | null {
  const m = /^\s*`?([A-Za-z_]\w*)`?\s+([\s\S]*?)\s*$/.exec(item)
  if (!m) return null
  const name = m[1].toLowerCase()
  if (COLUMN_SKIP_KEYWORDS.has(name)) return null
  let rest = m[2]
  let comment: string | null = null
  const cm = findCommentClause(rest)
  if (cm) {
    comment = cm.value
    rest = rest.slice(0, cm.index)
  }
  const dataType = rest.replace(/\s+/g, ' ').trim()
  if (!dataType) return null
  return { name, data_type: dataType, comment }
}

/** 定位平衡括号体的内容(从 open 处的 '(' 开始),返回内容与结束位置 */
function parenBody(text: string, open: number): { body: string; end: number } | null {
  if (text[open] !== '(') return null
  let depth = 1
  let inStr = false
  for (let i = open + 1; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (c === "'") {
        if (text[i + 1] === "'") i++
        else inStr = false
      }
      continue
    }
    if (c === "'") inStr = true
    else if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return { body: text.slice(open + 1, i), end: i }
    }
  }
  return null
}

const TABLE_REF = '[A-Za-z_`][\\w$`]*(?:\\.[A-Za-z_`][\\w$`]*)*'

/** 解析 CREATE TABLE 语句的字段清单(纯 DDL;CTAS 返回 null) */
export function parseCreateTableColumns(rawStatement: string): ParsedColumn[] | null {
  const m = new RegExp(
    `\\bcreate\\s+(?:or\\s+replace\\s+)?(?:temp(?:orary)?\\s+)?table\\s+(?:if\\s+not\\s+exists\\s+)?(${TABLE_REF})`,
    'i',
  ).exec(rawStatement)
  if (!m) return null
  const rest = rawStatement.slice(m.index + m[0].length)
  // CTAS:CREATE TABLE t AS SELECT ... —— 无字段清单
  if (/^\s*as\s*(?:\(?\s*select|\(?\s*with)/i.test(rest)) return null
  const openIdx = rawStatement.indexOf('(', m.index + m[0].length)
  if (openIdx < 0) return null
  const seg = parenBody(rawStatement, openIdx)
  if (!seg) return null
  const columns: ParsedColumn[] = []
  for (const item of splitTopLevel(seg.body)) {
    const col = parseColumnItem(item)
    if (col) columns.push(col)
  }
  return columns.length > 0 ? columns : null
}

/** 解析 ALTER TABLE 语句为增量操作(ADD/DROP/CHANGE COLUMNS,best-effort) */
export function parseAlterOps(rawStatement: string, table: string): AlterOp[] {
  const flat = rawStatement.replace(/\s+/g, ' ').trim()
  const ops: AlterOp[] = []
  const head = new RegExp(`\\balter\\s+table\\s+(${TABLE_REF})`, 'i').exec(flat)
  if (!head) return ops
  const rest = flat.slice(head.index + head[0].length)

  const addM = /^\s*add\s+(?:columns?\s+)?/i.exec(rest)
  if (addM) {
    const after = rest.slice(addM[0].length)
    const open = after.indexOf('(')
    if (open >= 0) {
      const seg = parenBody(after, open)
      if (seg) {
        for (const item of splitTopLevel(seg.body)) {
          const col = parseColumnItem(item)
          if (col) ops.push({ table, op: 'add', column: col })
        }
        return ops
      }
    }
    // ADD COLUMN name type(无括号)
    const col = parseColumnItem(after)
    if (col) ops.push({ table, op: 'add', column: col })
    return ops
  }

  const dropM = /^\s*drop\s+(?:columns?\s+)?/i.exec(rest)
  if (dropM) {
    let after = rest.slice(dropM[0].length).trim()
    if (after.startsWith('(')) {
      const seg = parenBody(after, 0)
      after = seg ? seg.body : after.replace(/^\(|\)$/g, '')
    }
    for (const name of after.split(',')) {
      const cleaned = name.trim().replace(/`/g, '').toLowerCase()
      if (/^[a-z_]\w*$/.test(cleaned)) ops.push({ table, op: 'drop', old_name: cleaned })
    }
    return ops
  }

  const changeM = /^\s*change\s+(?:column\s+)?`?([A-Za-z_]\w*)`?\s+([\s\S]*)$/i.exec(rest)
  if (changeM) {
    const col = parseColumnItem(changeM[2])
    if (col) ops.push({ table, op: 'change', old_name: changeM[1].toLowerCase(), column: col })
  }
  return ops
}

// ---------------------------------------------------------------- 解析入口(组合 parsePreview + DDL 解析)

export interface EngineEdge {
  target: string
  sources: string[]
  column_mapping: { target_col: string; sources: { table: string; column: string }[] }[]
}

export interface EngineParseResult {
  targets: string[]
  sources: string[]
  edges: EngineEdge[]
  columnsByTable: Record<string, ParsedColumn[]>
  alters: AlterOp[]
  warnings: string[]
}

/** parsePreview 的 ColumnMapping -> 后端 column_mapping JSON 形状 */
function toBackendMapping(mappings: ColumnMapping[]): EngineEdge['column_mapping'] {
  return mappings.map((m) => ({
    target_col: m.target,
    sources: m.sources.map((s) => {
      const dot = s.indexOf('.')
      return dot > 0
        ? { table: s.slice(0, dot), column: s.slice(dot + 1) }
        : { table: '', column: s }
    }),
  }))
}

function applyOpToList(cols: ParsedColumn[], op: AlterOp): void {
  if (op.op === 'add' && op.column) {
    if (!cols.some((c) => c.name === op.column!.name)) cols.push(op.column)
  } else if (op.op === 'drop' && op.old_name) {
    const idx = cols.findIndex((c) => c.name === op.old_name)
    if (idx >= 0) cols.splice(idx, 1)
  } else if (op.op === 'change' && op.old_name) {
    const cur = cols.find((c) => c.name === op.old_name)
    if (cur && op.column) {
      cur.name = op.column.name || cur.name
      cur.data_type = op.column.data_type || cur.data_type
      if (op.column.comment !== null) cur.comment = op.column.comment
    }
  }
}

/** 浏览器内 parse_script 等价物(口径与后端 sqlglot 解析一致,best-effort) */
export function engineParse(sqlText: string, targetTable?: string): EngineParseResult {
  const local = parseSqlLocally(sqlText, targetTable)
  const lines = sqlText.split('\n')
  const columnsByTable: Record<string, ParsedColumn[]> = {}
  const alters: AlterOp[] = []

  for (const st of local.statements) {
    const raw = lines
      .slice(st.lineStart - 1, st.lineEnd)
      .join('\n')
      .replace(/;\s*$/, '')
    if (st.type === 'CREATE' && st.target) {
      const cols = parseCreateTableColumns(raw)
      if (cols) columnsByTable[st.target] = cols
    } else if (st.type === 'ALTER' && st.target) {
      const ops = parseAlterOps(raw, st.target)
      const existing = columnsByTable[st.target]
      // 同脚本内已有 CREATE 全量定义时直接在其上演化(口径同后端 parser)
      if (existing) {
        for (const op of ops) applyOpToList(existing, op)
      } else {
        alters.push(...ops)
      }
    }
  }

  const edges: EngineEdge[] = local.statements
    .filter(
      (st) => (st.type === 'CTAS' || st.type === 'INSERT' || st.type === 'SELECT') && st.target,
    )
    .map((st) => ({
      target: st.target as string,
      sources: st.sources,
      column_mapping: toBackendMapping(local.columnMappings),
    }))

  return {
    targets: local.targets,
    sources: local.sources,
    edges,
    columnsByTable,
    alters,
    warnings: local.warnings.map((w) => w.text),
  }
}

export function detectSqlType(result: EngineParseResult): SqlType {
  return result.edges.length > 0 ? 'etl' : 'ddl'
}

// ---------------------------------------------------------------- 落库(service.py 等价物)

export function getOrCreateTable(state: MockState, name: string): { table: DataTable; created: boolean } {
  const existing = state.tables.find((t) => t.name === name)
  if (existing) return { table: existing, created: false }
  const now = nowIso()
  const table: DataTable = {
    id: nextId(state, 'table'),
    name,
    layer: layerOf(name),
    source_system_id: null,
    owner: '',
    description: '',
    created_at: now,
    updated_at: now,
  }
  state.tables.push(table)
  return { table, created: true }
}

export function columnsOf(state: MockState, tableId: number): TableColumn[] {
  return state.columns
    .filter((c) => c.table_id === tableId)
    .sort((a, b) => a.ordinal - b.ordinal)
}

export function replaceColumns(state: MockState, table: DataTable, cols: ParsedColumn[]): void {
  state.columns = state.columns.filter((c) => c.table_id !== table.id)
  cols.forEach((col, i) => {
    state.columns.push({
      id: nextId(state, 'column'),
      table_id: table.id,
      name: col.name,
      data_type: col.data_type,
      comment: col.comment,
      ordinal: i,
    })
  })
  table.updated_at = nowIso()
}

export function applyAlterOps(state: MockState, table: DataTable, ops: AlterOp[]): void {
  const cols = columnsOf(state, table.id)
  for (const op of ops) {
    if (op.op === 'add' && op.column) {
      if (!cols.some((c) => c.name === op.column!.name)) {
        const col: TableColumn = {
          id: nextId(state, 'column'),
          table_id: table.id,
          name: op.column.name,
          data_type: op.column.data_type,
          comment: op.column.comment,
          ordinal: cols.length ? Math.max(...cols.map((c) => c.ordinal)) + 1 : 0,
        }
        state.columns.push(col)
        cols.push(col)
      }
    } else if (op.op === 'drop' && op.old_name) {
      const idx = cols.findIndex((c) => c.name === op.old_name)
      if (idx >= 0) {
        state.columns = state.columns.filter((c) => c.id !== cols[idx].id)
        cols.splice(idx, 1)
      }
    } else if (op.op === 'change' && op.old_name) {
      const cur = cols.find((c) => c.name === op.old_name)
      if (cur && op.column) {
        cur.name = op.column.name || cur.name
        cur.data_type = op.column.data_type || cur.data_type
        if (op.column.comment !== null) cur.comment = op.column.comment
      }
    }
  }
  table.updated_at = nowIso()
}

export interface SyncInfo {
  added: [string, string][]
  removed: [string, string][]
  edges_created: number
}

/** 按解析结果增量同步脚本血缘边(唯一约束 src+dst+script,幂等) */
export function syncScriptEdges(state: MockState, script: SqlScript, result: EngineParseResult): SyncInfo {
  const desired = new Map<string, { srcId: number; dstId: number; mapping: string }>()
  for (const edge of result.edges) {
    const dst = getOrCreateTable(state, edge.target).table
    for (const srcName of edge.sources) {
      const src = getOrCreateTable(state, srcName).table
      desired.set(`${src.name}|${dst.name}`, {
        srcId: src.id,
        dstId: dst.id,
        mapping: JSON.stringify(edge.column_mapping),
      })
    }
  }

  const existing = new Map<string, LineageEdge>()
  for (const e of state.edges.filter((e) => e.script_id === script.id)) {
    const src = state.tables.find((t) => t.id === e.src_table_id)
    const dst = state.tables.find((t) => t.id === e.dst_table_id)
    if (src && dst) existing.set(`${src.name}|${dst.name}`, e)
  }

  const added: [string, string][] = []
  const removed: [string, string][] = []
  for (const [pair, info] of desired) {
    const cur = existing.get(pair)
    if (cur) {
      cur.column_mapping = info.mapping
    } else {
      state.edges.push({
        id: nextId(state, 'edge'),
        src_table_id: info.srcId,
        dst_table_id: info.dstId,
        script_id: script.id,
        column_mapping: info.mapping,
        created_at: nowIso(),
      })
      added.push(pair.split('|') as [string, string])
    }
  }
  for (const [pair, edge] of existing) {
    if (!desired.has(pair)) {
      state.edges = state.edges.filter((e) => e.id !== edge.id)
      removed.push(pair.split('|') as [string, string])
    }
  }
  return { added, removed, edges_created: added.length }
}

export interface PersistInfo {
  tables_created: string[]
  edges_created: number
  added: [string, string][]
  removed: [string, string][]
}

/** 解析结果落库:注册表/字段、应用 ALTER、写入血缘边(script 为 null 时不产边) */
export function persistParse(state: MockState, result: EngineParseResult, script: SqlScript | null): PersistInfo {
  const tablesCreated: string[] = []
  const touch = (name: string): DataTable => {
    const { table, created } = getOrCreateTable(state, name)
    if (created) tablesCreated.push(name)
    return table
  }

  for (const name of [...result.targets, ...result.sources]) touch(name)
  for (const [name, cols] of Object.entries(result.columnsByTable)) {
    replaceColumns(state, touch(name), cols)
  }
  const alterByTable = new Map<string, AlterOp[]>()
  for (const op of result.alters) {
    const list = alterByTable.get(op.table) ?? []
    list.push(op)
    alterByTable.set(op.table, list)
  }
  for (const [name, ops] of alterByTable) applyAlterOps(state, touch(name), ops)

  let sync: SyncInfo = { added: [], removed: [], edges_created: 0 }
  if (script) sync = syncScriptEdges(state, script, result)
  return { tables_created: tablesCreated, edges_created: sync.edges_created, added: sync.added, removed: sync.removed }
}

// ---------------------------------------------------------------- DDL 渲染与 diff

/** 由当前字段集重建规范化 DDL(变更事件 old_text,与后端 render_ddl 一致) */
export function renderDdl(state: MockState, table: DataTable): string {
  const lines = columnsOf(state, table.id).map((c) => {
    let line = `  ${c.name} ${c.data_type || 'STRING'}`
    if (c.comment) line += ` COMMENT '${c.comment}'`
    return line
  })
  return `CREATE TABLE ${table.name} (\n${lines.join(',\n')}\n)`
}

/** 数据类型规范化比较(忽略大小写与空白) */
function normType(t: string | null | undefined): string {
  return (t ?? '').replace(/\s+/g, '').toLowerCase()
}

interface SimpleColumn {
  name: string
  data_type: string
  comment: string | null
}

function columnDiffFromDicts(current: SimpleColumn[], next: SimpleColumn[]): ChangeDiff {
  const cur = new Map(current.map((c) => [c.name, c]))
  const newNames = new Set(next.map((c) => c.name))
  // 与后端 _column_diff_from_dicts 相同的键形状(added/removed 用 data_type/comment)
  return {
    added: next
      .filter((c) => !cur.has(c.name))
      .map((c) => ({ name: c.name, data_type: c.data_type, comment: c.comment })),
    removed: current
      .filter((c) => !newNames.has(c.name))
      .map((c) => ({ name: c.name, data_type: c.data_type, comment: c.comment })),
    type_changed: next
      .filter((c) => cur.has(c.name) && normType(c.data_type) !== normType(cur.get(c.name)!.data_type))
      .map((c) => ({ name: c.name, old_type: cur.get(c.name)!.data_type, new_type: c.data_type })),
  } as unknown as ChangeDiff
}

/** 解析 new_ddl 并与现有字段对比(支持全量 DDL 与 ALTER 两种形态,口径同后端) */
export function ddlDiff(state: MockState, table: DataTable, result: EngineParseResult): ChangeDiff {
  const current: SimpleColumn[] = columnsOf(state, table.id).map((c) => ({
    name: c.name,
    data_type: c.data_type,
    comment: c.comment,
  }))
  // 全量字段定义:优先同名表,否则取第一份
  let newCols: ParsedColumn[] | null = null
  for (const [name, cols] of Object.entries(result.columnsByTable)) {
    if (name === table.name) {
      newCols = cols
      break
    }
  }
  if (newCols === null) {
    const values = Object.values(result.columnsByTable)
    if (values.length > 0) newCols = values[0]
  }
  if (newCols !== null) {
    return columnDiffFromDicts(
      current,
      newCols.map((c) => ({ name: c.name, data_type: c.data_type, comment: c.comment })),
    )
  }

  // ALTER 形态:由操作推导 diff
  const diff = {
    added: [] as Record<string, unknown>[],
    removed: [] as Record<string, unknown>[],
    type_changed: [] as { name: string; old_type: string; new_type: string }[],
  }
  const curByName = new Map(current.map((c) => [c.name, c]))
  for (const op of result.alters) {
    if (op.table !== table.name) continue
    if (op.op === 'add' && op.column) {
      diff.added.push({ name: op.column.name, data_type: op.column.data_type, comment: op.column.comment })
    } else if (op.op === 'drop' && op.old_name) {
      const old = curByName.get(op.old_name) ?? { name: op.old_name, data_type: '', comment: null }
      diff.removed.push({ name: old.name, data_type: old.data_type, comment: old.comment })
    } else if (op.op === 'change' && op.old_name && op.column) {
      const old = curByName.get(op.old_name)
      if (op.column.name !== op.old_name) {
        // 改名:视为删旧增新
        diff.removed.push({
          name: op.old_name,
          data_type: old?.data_type ?? '',
          comment: old?.comment ?? null,
        })
        diff.added.push({ name: op.column.name, data_type: op.column.data_type, comment: op.column.comment })
      } else if (old && normType(old.data_type) !== normType(op.column.data_type)) {
        diff.type_changed.push({ name: op.old_name, old_type: old.data_type, new_type: op.column.data_type })
      }
    }
  }
  return diff as unknown as ChangeDiff
}

// ---------------------------------------------------------------- 影响分析(impact.py 等价物)

export interface ImpactResult {
  tables: DataTable[]
  reports: Report[]
  systems: System[]
}

/** 从种子表出发沿血缘边有向 BFS:全部下游表 + 受影响报表 + 报表目标系统 */
export function downstreamImpact(state: MockState, tableIds: number[]): ImpactResult {
  const seeds = [...new Set(tableIds.filter(Boolean))]
  const adj = new Map<number, number[]>()
  for (const e of state.edges) {
    const list = adj.get(e.src_table_id) ?? []
    list.push(e.dst_table_id)
    adj.set(e.src_table_id, list)
  }

  const visited = new Set(seeds)
  const queue = [...seeds]
  const downstream: number[] = []
  while (queue.length > 0) {
    const cur = queue.shift() as number
    for (const nxt of adj.get(cur) ?? []) {
      if (!visited.has(nxt)) {
        visited.add(nxt)
        downstream.push(nxt)
        queue.push(nxt)
      }
    }
  }

  const downSet = new Set(downstream)
  const tables = state.tables.filter((t) => downSet.has(t.id)).sort((a, b) => a.id - b.id)
  // 报表:建在下游表或变更对象本身上的报表都受影响
  const scope = new Set([...seeds, ...downstream])
  const reports = state.reports.filter((r) => scope.has(r.table_id)).sort((a, b) => a.id - b.id)
  const seenSys = new Set<number>()
  const systems: System[] = []
  for (const rep of reports) {
    if (rep.target_system_id && !seenSys.has(rep.target_system_id)) {
      seenSys.add(rep.target_system_id)
      const sys = state.systems.find((s) => s.id === rep.target_system_id)
      if (sys) systems.push(sys)
    }
  }
  return { tables, reports, systems }
}

// ---------------------------------------------------------------- 变更事件与审批任务

/** 额外审批任务(种子表影响面之外,如新建表的来源表 owner、被删表的 owner) */
export interface ExtraTask {
  approver_name: string
  approver_role: ApprovalTask['approver_role']
  target_type: ApprovalTask['target_type']
  target_id: number
  target_name: string
}

/** 创建 pending 变更事件 + 审批任务(此时不应用变更) */
export function createChangeEvent(
  state: MockState,
  args: {
    change_type: ChangeEvent['change_type']
    object_name: string
    old_text: string
    new_text: string
    diff: ChangeDiff
    submitted_by: string
    seed_table_ids: number[]
    extra_tasks?: ExtraTask[]
  },
): ChangeEvent {
  const event: ChangeEvent = {
    id: nextId(state, 'change'),
    change_type: args.change_type,
    object_name: args.object_name,
    old_text: args.old_text,
    new_text: args.new_text,
    diff_summary: JSON.stringify(args.diff),
    status: 'pending',
    submitted_by: args.submitted_by || '',
    created_at: nowIso(),
    resolved_at: null,
  }
  state.changes.push(event)

  const impact = downstreamImpact(state, args.seed_table_ids)
  const push = (t: Omit<ApprovalTask, 'id' | 'status' | 'comment' | 'decided_at'>) => {
    state.approvals.push({
      id: nextId(state, 'approval'),
      status: 'pending',
      comment: null,
      decided_at: null,
      ...t,
    })
  }
  for (const rep of impact.reports) {
    push({
      change_event_id: event.id,
      approver_name: rep.owner || '未设置',
      approver_role: 'report_owner',
      target_type: 'report',
      target_id: rep.id,
      target_name: rep.name,
    })
  }
  for (const sys of impact.systems) {
    push({
      change_event_id: event.id,
      approver_name: sys.owner || '未设置',
      approver_role: 'system_owner',
      target_type: 'system',
      target_id: sys.id,
      target_name: sys.name,
    })
  }
  for (const tbl of impact.tables) {
    push({
      change_event_id: event.id,
      approver_name: tbl.owner || '未设置',
      approver_role: 'table_owner',
      target_type: 'table',
      target_id: tbl.id,
      target_name: tbl.name,
    })
  }
  // 额外任务:按 (角色,目标) 去重,避免与影响面任务重复
  const seen = new Set(
    state.approvals
      .filter((a) => a.change_event_id === event.id)
      .map((a) => `${a.approver_role}|${a.target_type}|${a.target_id}`),
  )
  for (const t of args.extra_tasks ?? []) {
    const key = `${t.approver_role}|${t.target_type}|${t.target_id}`
    if (seen.has(key)) continue
    seen.add(key)
    push({ change_event_id: event.id, ...t })
  }
  return event
}

/** 审批全部通过后应用变更:ddl_change 替换字段集;sql_change 更新脚本并重解析边;
 * create_table 注册新表(CTAS 同时写入血缘边);drop_table 删除表、字段、关联边与绑定报表 */
export function applyChange(state: MockState, event: ChangeEvent): void {
  if (event.change_type === 'create_table') {
    const name = event.object_name
    if (state.tables.some((t) => t.name === name)) return // 已被其他途径创建,幂等跳过
    const result = engineParse(event.new_text)
    // 注册表与字段(不经过脚本)
    const { table } = getOrCreateTable(state, name)
    const cols = result.columnsByTable[name]
    if (cols) replaceColumns(state, table, cols)
    // CTAS:写入来源 → 新表的血缘边(script_id 为空,表示非脚本来源)
    for (const edge of result.edges) {
      if (edge.target !== name) continue
      for (const srcName of edge.sources) {
        const src = getOrCreateTable(state, srcName).table
        const exists = state.edges.some(
          (e) => e.src_table_id === src.id && e.dst_table_id === table.id,
        )
        if (!exists) {
          state.edges.push({
            id: nextId(state, 'edge'),
            src_table_id: src.id,
            dst_table_id: table.id,
            script_id: null as unknown as number,
            column_mapping: JSON.stringify(edge.column_mapping),
            created_at: nowIso(),
          })
        }
      }
    }
    return
  }
  if (event.change_type === 'drop_table') {
    const table = state.tables.find((t) => t.name === event.object_name)
    if (!table) return
    // 关联血缘边(作为上游或下游)、字段、绑定报表、表本身
    state.edges = state.edges.filter(
      (e) => e.src_table_id !== table.id && e.dst_table_id !== table.id,
    )
    state.columns = state.columns.filter((c) => c.table_id !== table.id)
    state.reports = state.reports.filter((r) => r.table_id !== table.id)
    state.tables = state.tables.filter((t) => t.id !== table.id)
    return
  }
  if (event.change_type === 'ddl_change') {
    const table = state.tables.find((t) => t.name === event.object_name)
    if (!table) return
    const result = engineParse(event.new_text)
    let cols: ParsedColumn[] | null = null
    for (const [name, c] of Object.entries(result.columnsByTable)) {
      if (name === table.name) {
        cols = c
        break
      }
    }
    if (cols === null) {
      const values = Object.values(result.columnsByTable)
      if (values.length > 0) cols = values[0]
    }
    if (cols !== null) replaceColumns(state, table, cols)
    else if (result.alters.length > 0) applyAlterOps(state, table, result.alters)
  } else if (event.change_type === 'sql_change') {
    const script = state.scripts.find((s) => s.name === event.object_name)
    if (!script) return
    const result = engineParse(event.new_text, script.target_table ?? undefined)
    script.sql_text = event.new_text
    script.sql_type = detectSqlType(result)
    script.version = (script.version || 1) + 1
    script.updated_at = nowIso()
    persistParse(state, result, script)
  }
}
