/**
 * LineageHub 前端 API 客户端
 * 与 architecture.md 第 2 节 REST API 契约逐一对应。
 * 全部走相对路径 /api/...,开发期由 vite proxy 转发到后端。
 */

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
  const res = await fetch(buildUrl(path, query), {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
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

// ---------- 系统 ----------

export const listSystems = () => request<System[]>('/systems')

export const createSystem = (payload: {
  name: string
  kind: SystemKind
  owner: string
  contact: string
  description: string
}) => request<System>('/systems', { method: 'POST', body: payload })

export const updateSystem = (id: number, payload: Partial<Omit<System, 'id'>>) =>
  request<System>(`/systems/${id}`, { method: 'PUT', body: payload })

export const deleteSystem = (id: number) =>
  request<void>(`/systems/${id}`, { method: 'DELETE' })

// ---------- 表 ----------

export const listTables = (params?: {
  keyword?: string
  layer?: TableLayer
  source_system_id?: number
}) => request<TableListItem[]>('/tables', { query: { ...params } })

export const getTable = (id: number) => request<TableDetail>(`/tables/${id}`)

export const updateTable = (
  id: number,
  payload: { source_system_id?: number | null; owner?: string; description?: string },
) => request<DataTable>(`/tables/${id}`, { method: 'PUT', body: payload })

// ---------- 脚本与解析 ----------

export const listScripts = () => request<SqlScript[]>('/scripts')

export const getScript = (id: number) => request<SqlScriptDetail>(`/scripts/${id}`)

export const parseScript = (payload: {
  name: string
  sql_text: string
  target_table?: string
}) => request<ParseResult>('/scripts/parse', { method: 'POST', body: payload })

export const updateScript = (id: number, payload: { sql_text: string }) =>
  request<ParseResult>(`/scripts/${id}`, { method: 'PUT', body: payload })

export const deleteScript = (id: number) =>
  request<void>(`/scripts/${id}`, { method: 'DELETE' })

// ---------- 报表 ----------

export const listReports = () => request<ReportListItem[]>('/reports')

export const createReport = (payload: Omit<Report, 'id'>) =>
  request<Report>('/reports', { method: 'POST', body: payload })

export const updateReport = (id: number, payload: Partial<Omit<Report, 'id'>>) =>
  request<Report>(`/reports/${id}`, { method: 'PUT', body: payload })

export const deleteReport = (id: number) =>
  request<void>(`/reports/${id}`, { method: 'DELETE' })

// ---------- 血缘图 ----------

export const getLineageOverview = () => request<GraphResponse>('/lineage/overview')

export const getLineageGraph = (params: {
  table_id: number
  direction?: 'upstream' | 'downstream' | 'both'
  depth?: number
}) =>
  request<GraphResponse>('/lineage/graph', {
    query: { direction: 'both', depth: 3, ...params },
  })

// ---------- 变更与审批 ----------

export const submitDdlChange = (payload: {
  table_id: number
  new_ddl: string
  submitted_by: string
}) => request<ChangeEvent>('/changes/ddl', { method: 'POST', body: payload })

export const submitSqlChange = (payload: {
  script_id: number
  new_sql: string
  submitted_by: string
}) => request<ChangeEvent>('/changes/sql', { method: 'POST', body: payload })

export const listChanges = () => request<ChangeEventSummary[]>('/changes')

export const getChange = (id: number) => request<ImpactDetail>(`/changes/${id}`)

export const listApprovals = (params?: { status?: ApprovalStatus; approver?: string }) =>
  request<ApprovalInboxItem[]>('/approvals', { query: { ...params } })

export const decideApproval = (
  id: number,
  payload: { decision: ApprovalDecision; comment?: string },
) => request<ChangeEvent>(`/approvals/${id}/decision`, { method: 'POST', body: payload })

// ---------- 仪表盘 ----------

export const getDashboardStats = () => request<DashboardStats>('/dashboard/stats')
