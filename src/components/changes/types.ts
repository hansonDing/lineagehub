/**
 * 变更与审批中心 — 后端实际响应类型与纯函数工具
 *
 * 注意:src/lib/api.ts 中部分声明(ApprovalInboxItem / ChangeEventSummary /
 * ImpactDetail)与后端实际返回存在出入,这里按 backend/app/schemas.py +
 * routers/changes.py 的真实契约重新定义,调用处以 `as unknown as` 收窄。
 */

import type {
  ApprovalTask,
  ChangeDiff,
  ChangeEvent,
  ChangeType,
  ColumnDiffEntry,
} from '@/lib/api'
import type { DiffLine } from '@/components/common/CodeEditor'
import { CHANGE_TYPE_NAMES } from '@/lib/format'

// ---------- 真实响应类型 ----------

/** GET /api/approvals 返回条目内嵌的事件摘要(后端只给这些字段) */
export interface InboxEventBrief {
  id: number
  change_type: ChangeType
  object_name: string
  status: string
  submitted_by: string
  created_at: string
}

/** GET /api/approvals 实际返回的收件箱条目 */
export interface InboxItem extends ApprovalTask {
  change_event: InboxEventBrief
}

/** GET /api/changes 实际返回的列表项(影响/任务计数字段名以后端为准) */
export interface ChangeListItemReal extends ChangeEvent {
  impact_count: number
  pending_tasks: number
  approved_tasks: number
}

/** 受影响对象(后端 event_impact 只回 id + name) */
export interface ImpactObject {
  id: number
  name: string
}

/** GET /api/changes/{id} 与 POST /api/changes/{ddl,sql} 实际返回 */
export interface ChangeDetailReal {
  event: ChangeEvent
  diff: ChangeDiff
  impacted_reports: ImpactObject[]
  impacted_systems: ImpactObject[]
  impacted_tables: ImpactObject[]
  approvals: ApprovalTask[]
}

// ---------- diff 摘要 ----------

/** 列 diff 条数统计 */
export function countColumnDiff(diff: ChangeDiff): {
  added: number
  removed: number
  changed: number
} {
  return {
    added: diff.added?.length ?? 0,
    removed: diff.removed?.length ?? 0,
    changed: diff.type_changed?.length ?? 0,
  }
}

/** 血缘边 diff 条数统计 */
export function countEdgeDiff(diff: ChangeDiff): { added: number; removed: number } {
  return {
    added: diff.edges_added?.length ?? 0,
    removed: diff.edges_removed?.length ?? 0,
  }
}

/** diff 是否为空(无任何字段/边变化) */
export function isDiffEmpty(diff: ChangeDiff | null | undefined): boolean {
  if (!diff) return true
  const c = countColumnDiff(diff)
  const e = countEdgeDiff(diff)
  return c.added + c.removed + c.changed + e.added + e.removed === 0
}

/** 差异一句话:「新增 2 字段,删除 1 字段,变更 1 字段类型」/「新增 1 条血缘边」 */
export function summarizeDiff(changeType: ChangeType, diff: ChangeDiff): string {
  const parts: string[] = []
  if (changeType === 'ddl_change') {
    const c = countColumnDiff(diff)
    if (c.added) parts.push(`新增 ${c.added} 字段`)
    if (c.removed) parts.push(`删除 ${c.removed} 字段`)
    if (c.changed) parts.push(`变更 ${c.changed} 字段类型`)
  } else {
    const e = countEdgeDiff(diff)
    if (e.added) parts.push(`新增 ${e.added} 条血缘边`)
    if (e.removed) parts.push(`移除 ${e.removed} 条血缘边`)
  }
  return parts.length ? parts.join(',') : '无结构差异'
}

/** 从 diff_summary(JSON 字符串)解析 diff;失败返回空 */
export function parseDiffSummary(diffSummary: string | null | undefined): ChangeDiff {
  if (!diffSummary) return {}
  try {
    const parsed = JSON.parse(diffSummary) as ChangeDiff
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** 变更条目标题:「dwd.dwd_trade_order_detail DDL 变更:新增 2 字段,变更 1 字段类型」 */
export function changeTitle(changeType: ChangeType, objectName: string, diff: ChangeDiff): string {
  return `${objectName} ${CHANGE_TYPE_NAMES[changeType]}:${summarizeDiff(changeType, diff)}`
}

/** 列 diff 条目的变更后类型(后端 added 用 data_type 键,兼容 new_type) */
export function columnNewType(entry: ColumnDiffEntry): string {
  const raw = entry as unknown as Record<string, unknown>
  return String(entry.new_type ?? raw.data_type ?? '')
}

/** 列 diff 条目的变更前类型(后端 removed 用 data_type 键,兼容 old_type) */
export function columnOldType(entry: ColumnDiffEntry): string {
  const raw = entry as unknown as Record<string, unknown>
  return String(entry.old_type ?? raw.data_type ?? '')
}

// ---------- 行级文本 diff(供 CodeEditor diff 行态) ----------

/** 简单 LCS 行 diff:旧→新,输出行级 added/removed/context(文本量小,DP 足够) */
export function lineDiff(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n')
  const b = newText.split('\n')
  const n = a.length
  const m = b.length
  // dp[i][j] = a[i:] 与 b[j:] 的 LCS 长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const lines: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      lines.push({ text: a[i], state: 'context' })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ text: a[i], state: 'removed' })
      i++
    } else {
      lines.push({ text: b[j], state: 'added' })
      j++
    }
  }
  while (i < n) {
    lines.push({ text: a[i], state: 'removed' })
    i++
  }
  while (j < m) {
    lines.push({ text: b[j], state: 'added' })
    j++
  }
  return lines
}

// ---------- 评论草稿(localStorage 暂存,接口失败不丢稿) ----------

const DRAFT_PREFIX = 'lineagehub:approval-comment:'

export function loadCommentDraft(taskId: number): string {
  try {
    return window.localStorage.getItem(DRAFT_PREFIX + taskId) ?? ''
  } catch {
    return ''
  }
}

export function saveCommentDraft(taskId: number, value: string) {
  try {
    if (value) window.localStorage.setItem(DRAFT_PREFIX + taskId, value)
    else window.localStorage.removeItem(DRAFT_PREFIX + taskId)
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

export function clearCommentDraft(taskId: number) {
  try {
    window.localStorage.removeItem(DRAFT_PREFIX + taskId)
  } catch {
    /* ignore */
  }
}
