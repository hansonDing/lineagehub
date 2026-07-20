/**
 * 变更事件(changes.md §3)
 * 时间线风格按日分组:状态圆点 + 标题 + ID + 类型徽标 + 审批进度环 + StatusBadge;
 * 点击行 → onOpenDetail 打开 720px 详情抽屉(?change=<id> 深链由父级管理)
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, GitBranchPlus } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { ChangeType } from '@/lib/api'
import { getChange, listChanges } from '@/lib/api'
import { formatChangeId, formatDateTime, relativeTime } from '@/lib/format'
import { EmptyState } from '@/components/common/EmptyState'
import { ChangeTypeBadge, StatusBadge } from '@/components/common/StatusBadge'
import { APPROVALS_REFRESH_EVENT } from '@/components/Layout'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ChangeDetailReal, ChangeListItemReal } from './types'
import { changeTitle, parseDiffSummary } from './types'
import { ProgressRing } from './shared'

type EventStatus = 'pending' | 'approving' | 'approved' | 'rejected'
type StatusFilter = 'all' | EventStatus
type TimeRange = '7d' | '30d' | 'all'

const STATUS_CHIPS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: '待审批' },
  { key: 'approving', label: '审批中' },
  { key: 'approved', label: '已生效' },
  { key: 'rejected', label: '已驳回' },
]

const STATUS_DOT: Record<EventStatus, string> = {
  pending: '#D97706',
  approving: '#D97706',
  approved: '#16A34A',
  rejected: '#DC2626',
}

/** 由列表计数推导展示状态:approved_tasks>0 的 pending 视为「审批中」 */
function deriveStatus(ev: ChangeListItemReal): EventStatus {
  if (ev.status === 'approved') return 'approved'
  if (ev.status === 'rejected') return 'rejected'
  return ev.approved_tasks > 0 ? 'approving' : 'pending'
}

const STATUS_BADGE_KEY: Record<EventStatus, string> = {
  pending: 'pending',
  approving: 'approving',
  approved: 'effective',
  rejected: 'rejected',
}

export function EventsTab({
  onOpenDetail,
  onCreate,
}: {
  onOpenDetail: (id: number) => void
  onCreate: () => void
}) {
  const [events, setEvents] = useState<ChangeListItemReal[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | ChangeType>('all')
  const [timeRange, setTimeRange] = useState<TimeRange>('all')
  const [details, setDetails] = useState<Map<number, ChangeDetailReal>>(new Map())

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(false)
    try {
      const list = (await listChanges()) as unknown as ChangeListItemReal[]
      setEvents(list)
      // 后台补齐详情(审批进度环 / 影响分类计数)
      for (const ev of list.slice(0, 50)) {
        getChange(ev.id)
          .then((d) => {
            setDetails((prev) => {
              if (prev.has(ev.id)) return prev
              return new Map(prev).set(ev.id, d as unknown as ChangeDetailReal)
            })
          })
          .catch(() => {})
      }
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 收件箱审批操作后同步刷新事件状态
  useEffect(() => {
    const handler = () => void load(true)
    window.addEventListener(APPROVALS_REFRESH_EVENT, handler)
    return () => window.removeEventListener(APPROVALS_REFRESH_EVENT, handler)
  }, [load])

  const counts = useMemo(() => {
    const map = new Map<StatusFilter, number>()
    map.set('all', events.length)
    for (const ev of events) {
      const s = deriveStatus(ev)
      map.set(s, (map.get(s) ?? 0) + 1)
    }
    return map
  }, [events])

  const filtered = useMemo(() => {
    const now = Date.now()
    return events.filter((ev) => {
      if (statusFilter !== 'all' && deriveStatus(ev) !== statusFilter) return false
      if (typeFilter !== 'all' && ev.change_type !== typeFilter) return false
      if (timeRange !== 'all') {
        const days = timeRange === '7d' ? 7 : 30
        if (now - new Date(ev.created_at).getTime() > days * 86_400_000) return false
      }
      return true
    })
  }, [events, statusFilter, typeFilter, timeRange])

  /** 按日分组(列表已按创建时间倒序) */
  const groups = useMemo(() => {
    const out: { date: string; items: ChangeListItemReal[] }[] = []
    for (const ev of filtered) {
      const date = formatDateTime(ev.created_at).slice(0, 10)
      const last = out[out.length - 1]
      if (last && last.date === date) last.items.push(ev)
      else out.push({ date, items: [ev] })
    }
    return out
  }, [filtered])

  return (
    <div>
      {/* 工具条 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          {STATUS_CHIPS.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setStatusFilter(chip.key)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-120',
                statusFilter === chip.key
                  ? 'border-primary-600 bg-primary-50 text-primary-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:text-slate-900',
              )}
            >
              {chip.label}
              <span className="tabular-nums text-slate-400">{counts.get(chip.key) ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as 'all' | ChangeType)}>
            <SelectTrigger className="h-8 w-[124px] border-slate-300 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部类型</SelectItem>
              <SelectItem value="ddl_change">DDL 变更</SelectItem>
              <SelectItem value="sql_change">SQL 变更</SelectItem>
            </SelectContent>
          </Select>
          <Select value={timeRange} onValueChange={(v) => setTimeRange(v as TimeRange)}>
            <SelectTrigger className="h-8 w-[112px] border-slate-300 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">近 7 天</SelectItem>
              <SelectItem value="30d">近 30 天</SelectItem>
              <SelectItem value="all">全部时间</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 事件列表 */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse-soft rounded-lg border border-slate-200 bg-slate-100" />
          ))}
        </div>
      ) : error ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-16 text-xs text-danger">
          <AlertCircle className="size-3.5" />
          变更事件加载失败
          <button type="button" onClick={() => void load()} className="text-primary-600 hover:underline">
            重试
          </button>
        </div>
      ) : groups.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white">
          <EmptyState
            image="/empty-change.svg"
            title="暂无变更事件"
            description="从 DDL 或 SQL 变更开始"
            action={
              <Button variant="secondary" onClick={onCreate}>
                <GitBranchPlus className="size-3.5" />
                发起变更
              </Button>
            }
          />
        </div>
      ) : (
        <div>
          {groups.map((group) => (
            <div key={group.date} className="mb-4">
              {/* 日期分隔行 */}
              <div className="mb-2 flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-500">{group.date}</span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="space-y-2">
                {group.items.map((ev, index) => {
                  const status = deriveStatus(ev)
                  const detail = details.get(ev.id)
                  const diff = parseDiffSummary(ev.diff_summary)
                  const title = changeTitle(ev.change_type, ev.object_name, diff)
                  const approvedCount = detail
                    ? detail.approvals.filter((a) => a.status === 'approved').length
                    : ev.approved_tasks
                  const totalCount = detail ? detail.approvals.length : ev.approved_tasks + ev.pending_tasks
                  return (
                    <motion.button
                      key={ev.id}
                      type="button"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.24,
                        delay: Math.min(index, 15) * 0.02,
                        ease: [0.22, 1, 0.36, 1],
                      }}
                      onClick={() => onOpenDetail(ev.id)}
                      className="flex h-16 w-full items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 text-left shadow-card transition-colors duration-120 hover:bg-slate-50"
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ backgroundColor: STATUS_DOT[status] }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-[13px] font-semibold text-slate-900" title={title}>
                            {title}
                          </span>
                          <span className="shrink-0 font-mono text-xs text-slate-400">
                            {formatChangeId(ev.id)}
                          </span>
                          <ChangeTypeBadge type={ev.change_type} className="shrink-0" />
                        </div>
                        <div className="mt-1 truncate text-xs text-slate-500">
                          {ev.submitted_by} 发起
                          {' · '}
                          {detail ? (
                            <>
                              影响 报表×{detail.impacted_reports.length} 系统×
                              {detail.impacted_systems.length} 表×{detail.impacted_tables.length}
                            </>
                          ) : (
                            <>影响对象×{ev.impact_count}</>
                          )}
                          {' · '}
                          <span title={formatDateTime(ev.created_at)}>{relativeTime(ev.created_at)}</span>
                        </div>
                      </div>
                      {detail ? (
                        <ProgressRing approved={approvedCount} total={totalCount} />
                      ) : (
                        <span className="size-8 shrink-0 animate-pulse-soft rounded-full bg-slate-100" />
                      )}
                      <StatusBadge status={STATUS_BADGE_KEY[status]} className="shrink-0" />
                    </motion.button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
