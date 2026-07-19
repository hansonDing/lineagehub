import type { ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  AlertCircle,
  BarChart3,
  Check,
  ChevronRight,
  Network,
  Plus,
  RefreshCw,
  Server,
  Table2,
  X,
} from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { ApprovalDecision, ApprovalInboxItem, DashboardStats } from '@/lib/api'
import { decideApproval, getDashboardStats, listApprovals } from '@/lib/api'
import { LAYER_COLORS, LAYER_NAMES, formatChangeId, relativeTime } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Avatar } from '@/components/common/Avatar'
import { EmptyState } from '@/components/common/EmptyState'
import { LayerBadge } from '@/components/common/LayerBadge'
import { ChangeTypeBadge, StatusBadge } from '@/components/common/StatusBadge'
import { StatCard } from '@/components/common/StatCard'
import { toast } from '@/components/common/Toast'
import { notifyApprovalsChanged } from '@/components/Layout'
import { useUser } from '@/hooks/useUser'

/** 首屏入场仅播放一次(路由切回不重放,dashboard.md §1) */
let entrancePlayed = false

const ENTRANCE = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
}

function Section({ index, className, children }: { index: number; className?: string; children: ReactNode }) {
  const shouldAnimate = !entrancePlayed
  return (
    <motion.section
      className={className}
      initial={shouldAnimate ? ENTRANCE.initial : false}
      animate={ENTRANCE.animate}
      transition={{ ...ENTRANCE.transition, delay: shouldAnimate ? index * 0.06 : 0 }}
    >
      {children}
    </motion.section>
  )
}

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-lg border border-slate-200 bg-white shadow-card', className)}>
      {children}
    </div>
  )
}

function CardHeader({ title, extra, action }: { title: ReactNode; extra?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex h-12 items-center justify-between border-b border-slate-100 px-4">
      <div className="flex items-center gap-2">
        <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
        {extra}
      </div>
      {action}
    </div>
  )
}

/** 内嵌错误条:12px 红字 + 重试 link,不弹窗阻断 */
function ErrorBar({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 text-xs text-danger">
      <AlertCircle className="size-3.5" />
      数据加载失败
      <button type="button" onClick={onRetry} className="text-primary-600 hover:underline">
        重试
      </button>
    </div>
  )
}

/** 骨架屏 */
function SkeletonRows({ rows = 3, height = 64 }: { rows?: number; height?: number }) {
  return (
    <div className="px-4 py-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-slate-100 last:border-b-0" style={{ height }}>
          <div className="h-4 w-16 animate-pulse-soft rounded bg-slate-100" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-3/5 animate-pulse-soft rounded bg-slate-100" />
            <div className="h-3 w-2/5 animate-pulse-soft rounded bg-slate-100" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** 由计数推导 7 日迷你趋势线(以末值为目标值的递增序列) */
function makeSpark(total: number): number[] {
  if (total <= 0) return [0, 0, 0, 0, 0, 0, 0]
  const ratios = [0.82, 0.85, 0.88, 0.9, 0.93, 0.96, 1]
  return ratios.map((r) => Math.max(1, Math.round(total * r)))
}

/** 变更摘要文案:「dwd.xxx 新增 2 个字段」 */
function summarizeChange(item: ApprovalInboxItem): string {
  const event = item.change_event
  const name = event?.object_name ?? item.target_name
  try {
    const diff = JSON.parse(event?.diff_summary ?? '{}') as Record<string, unknown[]>
    if (event?.change_type === 'ddl_change') {
      const added = Array.isArray(diff.added) ? diff.added.length : 0
      const removed = Array.isArray(diff.removed) ? diff.removed.length : 0
      const changed = Array.isArray(diff.type_changed) ? diff.type_changed.length : 0
      const parts: string[] = []
      if (added) parts.push(`新增 ${added} 个字段`)
      if (removed) parts.push(`删除 ${removed} 个字段`)
      if (changed) parts.push(`变更 ${changed} 个字段类型`)
      if (parts.length) return `${name} ${parts.join(',')}`
    } else {
      const added = Array.isArray(diff.edges_added) ? diff.edges_added.length : 0
      const removed = Array.isArray(diff.edges_removed) ? diff.edges_removed.length : 0
      const parts: string[] = []
      if (added) parts.push(`新增 ${added} 条血缘边`)
      if (removed) parts.push(`移除 ${removed} 条血缘边`)
      if (parts.length) return `${name} ${parts.join(',')}`
    }
  } catch {
    /* diff_summary 非 JSON 时回退 */
  }
  return `${name} 变更待审批`
}

// ---------- 待办审批 ----------

interface PendingDecision {
  taskId: number
  decision: ApprovalDecision
  timer: ReturnType<typeof setTimeout>
}

function ApprovalsCard({
  items,
  loading,
  error,
  onRetry,
  onCommitted,
}: {
  items: ApprovalInboxItem[]
  loading: boolean
  error: boolean
  onRetry: () => void
  onCommitted: () => void
}) {
  const navigate = useNavigate()
  // 已决策但仍在撤销窗口内的任务(乐观移除,5s 后真正提交)
  const [pending, setPending] = useState<Map<number, PendingDecision>>(new Map())
  // 决策形变中的行(按钮收缩为状态标)
  const [morphing, setMorphing] = useState<Map<number, ApprovalDecision>>(new Map())
  const pendingRef = useRef(pending)
  pendingRef.current = pending

  useEffect(() => {
    const map = pendingRef.current
    return () => {
      for (const p of map.values()) clearTimeout(p.timer)
    }
  }, [])

  const visible = items.filter((i) => !pending.has(i.id)).slice(0, 5)
  const processedCount = pending.size

  const decide = (item: ApprovalInboxItem, decision: ApprovalDecision) => {
    if (pending.has(item.id)) return
    // 1. 按钮形变反馈(design.md §8.3)
    setMorphing((m) => new Map(m).set(item.id, decision))
    // 2. 400ms 形变 + 300ms 行淡出后进入撤销窗口
    const timer = setTimeout(() => {
      setMorphing((m) => {
        const next = new Map(m)
        next.delete(item.id)
        return next
      })
      setPending((m) => {
        const next = new Map(m)
        next.set(item.id, {
          taskId: item.id,
          decision,
          timer: setTimeout(() => void commit(item.id), 5000),
        })
        return next
      })
    }, 700)
    void timer
  }

  const commit = async (taskId: number) => {
    const entry = pendingRef.current.get(taskId)
    if (!entry) return
    setPending((m) => {
      const next = new Map(m)
      next.delete(taskId)
      return next
    })
    try {
      await decideApproval(taskId, { decision: entry.decision })
      toast.success(
        entry.decision === 'approved' ? '已通过' : '已驳回',
        `审批任务 #${taskId} 处理完成`,
      )
      notifyApprovalsChanged()
      onCommitted()
    } catch {
      toast.error('操作失败', '审批提交失败,请重试')
      onCommitted() // 重新拉取以恢复行
    }
  }

  const undo = (taskId: number) => {
    const entry = pending.get(taskId)
    if (!entry) return
    clearTimeout(entry.timer)
    setPending((m) => {
      const next = new Map(m)
      next.delete(taskId)
      return next
    })
    toast.info('已撤销', '审批操作已取消')
  }

  return (
    <Card>
      <CardHeader
        title="待办审批"
        extra={
          items.length > 0 && (
            <span className="rounded bg-pending px-1.5 text-[11px] font-medium leading-4 text-white">
              {items.length}
            </span>
          )
        }
        action={
          <Button variant="link" onClick={() => navigate('/changes?tab=inbox')}>
            全部审批 →
          </Button>
        }
      />
      {loading ? (
        <SkeletonRows rows={3} height={64} />
      ) : error ? (
        <ErrorBar onRetry={onRetry} />
      ) : visible.length === 0 && processedCount === 0 ? (
        <EmptyState
          image="/empty-approval.svg"
          title="没有待处理的审批"
          description="所有变更都已处理完毕"
        />
      ) : (
        <div>
          <AnimatePresence initial={false}>
            {visible.map((item, index) => {
              const morph = morphing.get(item.id)
              const event = item.change_event
              return (
                <motion.div
                  key={item.id}
                  layout="position"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{
                    duration: index < 5 ? 0.24 : 0,
                    delay: entrancePlayed ? 0 : index * 0.02,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className="overflow-hidden"
                >
                  <div
                    onClick={() => navigate(`/changes?tab=inbox&change=${item.change_event_id}`)}
                    className="flex h-16 cursor-pointer items-center gap-3 border-b border-slate-100 px-4 transition-colors duration-120 hover:bg-slate-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <ChangeTypeBadge type={event?.change_type ?? 'ddl_change'} />
                        <span className="truncate text-[13px] font-semibold text-slate-900">
                          {summarizeChange(item)}
                        </span>
                        <StatusBadge status="pending" className="shrink-0" />
                      </div>
                      <div className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                        <span className="font-mono">{formatChangeId(item.change_event_id)}</span>
                        <span>·</span>
                        <span>{event?.submitted_by ?? '-'} 提交</span>
                        <span>·</span>
                        <span title={event?.created_at}>{relativeTime(event?.created_at)}</span>
                        {event && (
                          <>
                            <span>·</span>
                            <span>
                              影响 报表×{event.impacted_report_count} 系统×{event.impacted_system_count}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                    {/* 行内操作 / 决策形变 */}
                    <div
                      className="flex shrink-0 items-center gap-2"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {morph ? (
                        <motion.span
                          initial={{ scaleX: 0.6, opacity: 0.6 }}
                          animate={{ scaleX: 1, opacity: 1 }}
                          transition={{ duration: 0.4, ease: 'easeOut' }}
                          className={cn(
                            'flex h-7 origin-left items-center gap-1 rounded-md px-2.5 text-[12px] font-medium text-white',
                            morph === 'approved' ? 'bg-success' : 'bg-danger',
                          )}
                        >
                          {morph === 'approved' ? <Check className="size-3.5" /> : <X className="size-3.5" />}
                          {morph === 'approved' ? '已通过' : '已驳回'}
                        </motion.span>
                      ) : (
                        <>
                          <Button size="sm" variant="approve" onClick={() => decide(item, 'approved')}>
                            通过
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => decide(item, 'rejected')}>
                            驳回
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="详情"
                            onClick={() => navigate(`/changes?tab=inbox&change=${item.change_event_id}`)}
                          >
                            <ChevronRight className="size-4" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>
          {/* 内联 snackbar:已处理 N 条 · 撤销 */}
          <AnimatePresence>
            {processedCount > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="flex h-10 items-center justify-between border-t border-slate-100 bg-slate-50 px-4 text-xs text-slate-600"
              >
                <span>已处理 {processedCount} 条</span>
                <button
                  type="button"
                  onClick={() => undo(Array.from(pending.keys())[0])}
                  className="font-medium text-primary-600 hover:underline"
                >
                  撤销
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}
    </Card>
  )
}

// ---------- 分层分布 ----------

const LAYER_ORDER = ['ods', 'dim', 'dwd', 'dws', 'ads'] as const

function LayerDistributionCard({
  stats,
  loading,
  error,
  onRetry,
}: {
  stats: DashboardStats | null
  loading: boolean
  error: boolean
  onRetry: () => void
}) {
  const navigate = useNavigate()
  const distribution = useMemo(() => {
    const map = new Map((stats?.layer_distribution ?? []).map((d) => [d.layer, d.count]))
    return LAYER_ORDER.map((layer) => ({ layer, count: map.get(layer) ?? 0 }))
  }, [stats])
  const total = stats?.table_count ?? distribution.reduce((s, d) => s + d.count, 0)

  return (
    <Card>
      <CardHeader
        title="数仓分层分布"
        action={<span className="text-xs text-slate-500">共 {total} 张表</span>}
      />
      {loading ? (
        <SkeletonRows rows={5} height={40} />
      ) : error ? (
        <ErrorBar onRetry={onRetry} />
      ) : (
        <div className="py-1">
          {distribution.map((d, index) => {
            const pct = total > 0 ? (d.count / total) * 100 : 0
            const color = LAYER_COLORS[d.layer]
            return (
              <button
                key={d.layer}
                type="button"
                onClick={() => navigate(`/metadata?tab=tables&layer=${d.layer}`)}
                className="flex h-10 w-full items-center gap-3 px-4 text-left transition-colors duration-120 hover:bg-slate-50"
              >
                <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <LayerBadge layer={d.layer} />
                <span className="w-10 text-xs text-slate-500">{LAYER_NAMES[d.layer]}</span>
                <span className="h-2 flex-1 overflow-hidden rounded bg-slate-100">
                  <motion.span
                    className="block h-full rounded"
                    style={{ backgroundColor: color }}
                    initial={{ width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{
                      duration: 0.6,
                      delay: entrancePlayed ? 0 : index * 0.06,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                  />
                </span>
                <span className="w-8 text-right font-mono text-[13px] text-slate-900">{d.count}</span>
                <span className="w-12 text-right text-[11px] text-slate-400">{pct.toFixed(1)}%</span>
              </button>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ---------- 最近变更 ----------

function RecentChangesCard({
  stats,
  loading,
  error,
  onRetry,
}: {
  stats: DashboardStats | null
  loading: boolean
  error: boolean
  onRetry: () => void
}) {
  const navigate = useNavigate()
  const changes = (stats?.recent_changes ?? []).slice(0, 6)
  const dotColor = { approved: '#16A34A', pending: '#D97706', rejected: '#DC2626' } as const

  return (
    <Card>
      <CardHeader
        title="最近变更"
        action={
          <Button variant="link" onClick={() => navigate('/changes?tab=events')}>
            变更中心 →
          </Button>
        }
      />
      {loading ? (
        <SkeletonRows rows={4} height={56} />
      ) : error ? (
        <ErrorBar onRetry={onRetry} />
      ) : changes.length === 0 ? (
        <EmptyState
          image="/empty-change.svg"
          title="暂无变更事件"
          description="上游 DDL 或 SQL 发生变更时会在这里出现"
        />
      ) : (
        <div className="py-1">
          {changes.map((change, index) => (
            <motion.div
              key={change.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{
                duration: 0.24,
                delay: entrancePlayed ? 0 : index * 0.03,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <button
                type="button"
                onClick={() => navigate(`/changes?tab=events&change=${change.id}`)}
                className="flex h-14 w-full items-stretch gap-3 px-4 text-left transition-colors duration-120 hover:bg-slate-50"
              >
                {/* 时间线轴 */}
                <span className="relative flex w-2 shrink-0 justify-center">
                  {index < changes.length - 1 && (
                    <span className="absolute inset-y-0 w-px bg-slate-200" aria-hidden />
                  )}
                  <span
                    className="relative z-10 mt-5 size-2 rounded-full ring-2 ring-white"
                    style={{ backgroundColor: dotColor[change.status] ?? '#94A3B8' }}
                  />
                </span>
                <span className="min-w-0 flex-1 py-2">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-slate-900">
                      <span className="font-mono">{change.object_name}</span>{' '}
                      {change.change_type === 'ddl_change' ? 'DDL 变更' : 'SQL 变更'}
                    </span>
                    <StatusBadge status={change.status} className="shrink-0" />
                  </span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    <span className="font-mono">{formatChangeId(change.id)}</span>
                    {' · '}
                    {change.submitted_by}
                    {' · '}
                    <span title={change.created_at}>{relativeTime(change.created_at)}</span>
                  </span>
                </span>
              </button>
            </motion.div>
          ))}
        </div>
      )}
    </Card>
  )
}

// ---------- 热点表 Top 5 ----------

function HotTablesCard({
  stats,
  loading,
  error,
  onRetry,
}: {
  stats: DashboardStats | null
  loading: boolean
  error: boolean
  onRetry: () => void
}) {
  const navigate = useNavigate()
  const tables = (stats?.hot_tables ?? []).slice(0, 5)
  const maxDownstream = Math.max(1, ...tables.map((t) => t.downstream))

  return (
    <Card>
      <CardHeader
        title="下游影响 Top 表"
        action={<span className="text-xs text-slate-500">按直接+间接下游表数量排序</span>}
      />
      {loading ? (
        <SkeletonRows rows={5} height={44} />
      ) : error ? (
        <ErrorBar onRetry={onRetry} />
      ) : tables.length === 0 ? (
        <EmptyState
          image="/empty-table.svg"
          title="暂无血缘数据"
          description="提交 SQL 脚本后,这里会展示下游影响最大的表"
        />
      ) : (
        <div className="py-1">
          {tables.map((table, index) => {
            const reports = table.downstream_reports ?? 0
            const barColor = LAYER_COLORS[table.layer ?? 'other']
            return (
              <motion.div
                key={table.name}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.24,
                  delay: entrancePlayed ? 0 : index * 0.02,
                  ease: [0.22, 1, 0.36, 1],
                }}
              >
                <button
                  type="button"
                  onClick={() => navigate(`/lineage?table=${table.name}`)}
                  className="flex h-11 w-full items-center gap-3 px-4 text-left transition-colors duration-120 hover:bg-slate-50"
                >
                  <span className="w-6 shrink-0 font-mono text-[13px] text-slate-400">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  {table.layer && <LayerBadge layer={table.layer} />}
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-slate-900">
                    {table.name}
                  </span>
                  {table.owner && (
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
                      <Avatar name={table.owner} size={24} />
                      {table.owner}
                    </span>
                  )}
                  <span className="flex w-28 shrink-0 items-center justify-end gap-2">
                    <span className="font-mono text-[13px] text-slate-900">下游 {table.downstream}</span>
                    <span className="h-1 w-12 overflow-hidden rounded bg-slate-100">
                      <motion.span
                        className="block h-full rounded"
                        style={{ backgroundColor: barColor }}
                        initial={{ width: 0 }}
                        animate={{ width: `${(table.downstream / maxDownstream) * 100}%` }}
                        transition={{ duration: 0.5, delay: entrancePlayed ? 0 : index * 0.05 }}
                      />
                    </span>
                  </span>
                  <span className="flex w-14 shrink-0 items-center justify-end gap-1 font-mono text-[13px] text-slate-900">
                    {reports > 0 && <BarChart3 className="size-3 text-layer-ads" />}
                    {reports > 0 ? `报表 ${reports}` : '—'}
                  </span>
                </button>
              </motion.div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

// ---------- 页面 ----------

export default function Dashboard() {
  const navigate = useNavigate()
  const { user } = useUser()
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [statsError, setStatsError] = useState(false)
  const [approvals, setApprovals] = useState<ApprovalInboxItem[]>([])
  const [approvalsLoading, setApprovalsLoading] = useState(true)
  const [approvalsError, setApprovalsError] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)

  const fetchStats = useCallback(async () => {
    setStatsError(false)
    try {
      const data = await getDashboardStats()
      setStats(data)
      setUpdatedAt(new Date())
    } catch {
      setStatsError(true)
    } finally {
      setStatsLoading(false)
    }
  }, [])

  const fetchApprovals = useCallback(async () => {
    setApprovalsError(false)
    try {
      const data = await listApprovals({ status: 'pending', approver: user })
      setApprovals(data)
    } catch {
      setApprovalsError(true)
      setApprovals([])
    } finally {
      setApprovalsLoading(false)
    }
  }, [user])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])
  useEffect(() => {
    fetchApprovals()
  }, [fetchApprovals])

  // 首屏入场只播放一次
  useEffect(() => {
    const timer = setTimeout(() => {
      entrancePlayed = true
    }, 1200)
    return () => clearTimeout(timer)
  }, [])

  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true)
    setStatsLoading(false)
    const started = Date.now()
    await Promise.all([fetchStats(), fetchApprovals()])
    // 旋转最短 400ms,避免闪烁
    const remain = 400 - (Date.now() - started)
    setTimeout(() => setRefreshing(false), Math.max(0, remain))
  }

  const isEmpty =
    !statsLoading &&
    !statsError &&
    stats !== null &&
    stats.table_count === 0 &&
    stats.edge_count === 0 &&
    stats.report_count === 0

  const statCards = [
    {
      label: '数仓表',
      icon: Table2,
      value: stats?.table_count ?? 0,
      delta: undefined,
      hint: stats ? `覆盖 ${stats.layer_distribution.length} 个分层` : undefined,
      path: '/metadata?tab=tables',
    },
    {
      label: '血缘边',
      icon: Network,
      value: stats?.edge_count ?? 0,
      delta: undefined,
      hint:
        stats && stats.table_count > 0
          ? `覆盖 ${Math.min(100, Math.round((stats.edge_count / Math.max(1, stats.table_count)) * 100))}% 的数仓表`
          : undefined,
      path: '/lineage',
    },
    {
      label: '业务系统',
      icon: Server,
      value: stats?.system_count ?? 0,
      delta: '0',
      hint: '含来源系统与目标系统',
      path: '/metadata?tab=systems',
    },
    {
      label: '报表',
      icon: BarChart3,
      value: stats?.report_count ?? 0,
      delta: undefined,
      hint: stats ? `待办审批 ${stats.pending_approvals} 条` : undefined,
      path: '/metadata?tab=reports',
    },
  ]

  return (
    <div className="mx-auto max-w-[1600px]">
      {/* 页面头 */}
      <Section index={0} className="mb-4 flex items-center justify-between">
        <div className="flex items-baseline gap-3">
          <h1 className="text-xl font-semibold leading-7 text-slate-900">总览</h1>
          <span className="text-xs text-slate-500">
            数据血缘平台运行状况 · 更新于 {updatedAt ? relativeTime(updatedAt.toISOString()) : '—'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={refresh} disabled={refreshing}>
            <RefreshCw
              className={cn('size-3.5', refreshing && 'animate-spin [animation-duration:800ms]')}
            />
            刷新
          </Button>
          <Button variant="primary" onClick={() => navigate('/sql')}>
            <Plus className="size-3.5" />
            提交 SQL
          </Button>
        </div>
      </Section>

      {/* 全部数据为空提示条 */}
      {isEmpty && (
        <Section index={1} className="mb-4">
          <div className="flex h-11 items-center gap-2 rounded-lg border border-info/20 bg-info-light px-4 text-[13px] text-slate-700">
            <AlertCircle className="size-4 text-info" />
            系统暂无数据,提交第一个 SQL 脚本开始构建血缘
            <Button size="sm" variant="secondary" className="ml-auto" onClick={() => navigate('/sql')}>
              去提交 SQL
            </Button>
          </div>
        </Section>
      )}

      {/* 统计卡行(四卡 stagger 40ms 入场) */}
      <Section index={1} className="grid grid-cols-12 gap-4">
        {statCards.map((card, index) => (
          <motion.div
            key={card.label}
            className="col-span-12 sm:col-span-6 xl:col-span-3"
            initial={entrancePlayed ? false : ENTRANCE.initial}
            animate={ENTRANCE.animate}
            transition={{ ...ENTRANCE.transition, delay: entrancePlayed ? 0 : index * 0.04 }}
          >
            {statsLoading ? (
              <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-card">
                <div className="h-3.5 w-16 animate-pulse-soft rounded bg-slate-100" />
                <div className="mt-3 h-[34px] w-24 animate-pulse-soft rounded bg-slate-100" />
                <div className="mt-3 h-4 w-32 animate-pulse-soft rounded bg-slate-100" />
              </div>
            ) : (
              <StatCard
                label={card.label}
                icon={card.icon}
                value={card.value}
                delta={card.delta}
                hint={card.hint}
                spark={makeSpark(card.value)}
                onClick={() => navigate(card.path)}
              />
            )}
          </motion.div>
        ))}
      </Section>

      {/* 待办审批 + 分层分布 */}
      <Section index={2} className="mt-4 grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-7">
          <ApprovalsCard
            items={approvals}
            loading={approvalsLoading}
            error={approvalsError}
            onRetry={fetchApprovals}
            onCommitted={fetchApprovals}
          />
        </div>
        <div className="col-span-12 xl:col-span-5">
          <LayerDistributionCard
            stats={stats}
            loading={statsLoading}
            error={statsError}
            onRetry={fetchStats}
          />
        </div>
      </Section>

      {/* 最近变更 + 热点表 */}
      <Section index={3} className="mt-4 grid grid-cols-12 gap-4">
        <div className="col-span-12 xl:col-span-5">
          <RecentChangesCard
            stats={stats}
            loading={statsLoading}
            error={statsError}
            onRetry={fetchStats}
          />
        </div>
        <div className="col-span-12 xl:col-span-7">
          <HotTablesCard
            stats={stats}
            loading={statsLoading}
            error={statsError}
            onRetry={fetchStats}
          />
        </div>
      </Section>
    </div>
  )
}
