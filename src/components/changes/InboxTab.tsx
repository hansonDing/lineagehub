/**
 * 审批收件箱(changes.md §2)
 * 按当前用户过滤(?approver=<当前用户>),卡片含变更摘要/影响对象/字段 diff 展开/
 * 评论输入/通过·驳回(均需确认,按钮按 design.md §8.3 状态形变反馈);
 * 评论草稿 localStorage 暂存,接口失败红字条 + 重试不丢稿。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { ApprovalDecision, ChangeType } from '@/lib/api'
import { decideApproval, getChange, listApprovals } from '@/lib/api'
import { CHANGE_TYPE_NAMES, formatChangeId, formatDateTime, relativeTime } from '@/lib/format'
import { Avatar } from '@/components/common/Avatar'
import { EmptyState } from '@/components/common/EmptyState'
import { ChangeTypeBadge, StatusBadge } from '@/components/common/StatusBadge'
import { toast } from '@/components/common/Toast'
import { notifyApprovalsChanged } from '@/components/Layout'
import { useUser } from '@/hooks/useUser'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ChangeDetailReal, InboxItem } from './types'
import {
  changeTitle,
  clearCommentDraft,
  isDiffEmpty,
  loadCommentDraft,
  saveCommentDraft,
} from './types'
import {
  ApprovalStateIcon,
  ChangeDiffView,
  ImpactChips,
  RoleBadge,
} from './shared'

type Scope = 'mine' | 'done' | 'all'
type SortKey = 'latest' | 'impact'

const SCOPE_META: Record<Scope, { label: string; emptyTitle: string; emptyDesc: string }> = {
  mine: { label: '待我审批', emptyTitle: '没有待处理的审批', emptyDesc: '所有变更都已处理完毕' },
  done: { label: '我已处理', emptyTitle: '还没有已处理的审批', emptyDesc: '处理过的审批会出现在这里' },
  all: { label: '全部', emptyTitle: '没有相关审批', emptyDesc: '与你相关的审批任务会出现在这里' },
}

function impactTotal(detail: ChangeDetailReal | undefined): number {
  if (!detail) return 0
  return (
    detail.impacted_reports.length + detail.impacted_systems.length + detail.impacted_tables.length
  )
}

// ---------- 决策二次确认 Popover ----------

function DecisionConfirm({
  decision,
  reportCount,
  onConfirm,
  children,
}: {
  decision: ApprovalDecision
  reportCount: number
  onConfirm: () => void
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const approve = decision === 'approved'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="end" className="w-64 border-slate-200 bg-white">
        <p className="text-[13px] font-semibold text-slate-900">
          {approve ? '确认通过该变更?' : '确认驳回该变更?'}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {approve
            ? reportCount > 0
              ? `影响 ${reportCount} 个报表`
              : '通过后继续等待其他审批人'
            : '驳回后其余待审批任务将关闭'}
        </p>
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
            取消
          </Button>
          <Button
            variant={approve ? 'approve' : 'danger'}
            size="sm"
            onClick={() => {
              setOpen(false)
              onConfirm()
            }}
          >
            确认{approve ? '通过' : '驳回'}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ---------- 单个审批卡片 ----------

function ApprovalCard({
  item,
  detail,
  detailFailed,
  expanded,
  morph,
  submitting,
  actionError,
  commentError,
  onToggle,
  onRetryDetail,
  onDecide,
  onRetryDecision,
  onCommentChange,
  comment,
}: {
  item: InboxItem
  detail: ChangeDetailReal | undefined
  detailFailed: boolean
  expanded: boolean
  morph: ApprovalDecision | undefined
  submitting: boolean
  actionError: string | undefined
  commentError: boolean
  comment: string
  onToggle: () => void
  onRetryDetail: () => void
  onDecide: (decision: ApprovalDecision) => void
  onRetryDecision: () => void
  onCommentChange: (value: string) => void
}) {
  const event = item.change_event
  const type: ChangeType = event?.change_type ?? 'ddl_change'
  const title = detail
    ? changeTitle(type, event?.object_name ?? item.target_name, detail.diff)
    : `${event?.object_name ?? item.target_name} ${CHANGE_TYPE_NAMES[type]}`
  const isPending = item.status === 'pending'
  const diffEmpty = detail ? isDiffEmpty(detail.diff) : false

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card">
      {/* 主行 */}
      <div
        className="flex h-14 cursor-pointer items-center gap-2.5 px-4"
        onClick={onToggle}
        role="button"
        aria-expanded={expanded}
      >
        <ChangeTypeBadge type={type} className="shrink-0" />
        <span className="truncate text-sm font-semibold text-slate-900" title={title}>
          {title}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <StatusBadge status={item.status} />
          <span className="hidden text-xs text-slate-500 md:inline">
            <span className="font-mono">{formatChangeId(item.change_event_id)}</span>
            {' · '}
            {event?.submitted_by ?? '-'}
            {' · '}
            <span title={formatDateTime(event?.created_at)}>{relativeTime(event?.created_at)}</span>
          </span>
          <ChevronDown
            className={cn(
              'size-4 text-slate-400 transition-transform duration-180',
              expanded && 'rotate-180',
            )}
          />
        </div>
      </div>

      {/* 影响摘要行 */}
      <div className="flex items-center gap-3 border-t border-slate-100 px-4 py-2">
        {detail ? (
          <ImpactChips
            reports={detail.impacted_reports.map((r) => r.name)}
            systems={detail.impacted_systems.map((s) => s.name)}
            tables={detail.impacted_tables.map((t) => t.name)}
          />
        ) : detailFailed ? (
          <span className="flex items-center gap-2 text-xs text-danger">
            影响信息加载失败
            <button type="button" onClick={onRetryDetail} className="text-primary-600 hover:underline">
              重试
            </button>
          </span>
        ) : (
          <span className="h-4 w-48 animate-pulse-soft rounded bg-slate-100" />
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-slate-500">
          我的角色
          <RoleBadge role={item.approver_role} />
        </span>
      </div>

      {/* 展开区 */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="space-y-4 border-t border-slate-100 p-4">
              {/* 变更差异 */}
              <section>
                <h4 className="mb-2 text-xs font-medium text-slate-500">变更差异</h4>
                {detail ? (
                  diffEmpty ? (
                    <p className="rounded-md bg-info-light px-3 py-2 text-xs text-info">
                      结构化差异为空,可在变更事件详情中查看全文对比
                    </p>
                  ) : (
                    <ChangeDiffView type={type} diff={detail.diff} />
                  )
                ) : (
                  <div className="h-20 animate-pulse-soft rounded-md bg-slate-100" />
                )}
              </section>

              {/* 全部审批人进度 */}
              <section>
                <h4 className="mb-2 text-xs font-medium text-slate-500">全部审批人</h4>
                {detail ? (
                  <>
                    <div className="mb-2 flex -space-x-1.5">
                      {detail.approvals.map((a) => (
                        <Avatar key={a.id} name={a.approver_name} size={24} stacked />
                      ))}
                    </div>
                    <ul className="space-y-1.5">
                      {detail.approvals.map((a) => (
                        <li key={a.id} className="flex items-center gap-2 text-[13px]">
                          <Avatar name={a.approver_name} size={24} />
                          <span className="font-medium text-slate-900">{a.approver_name}</span>
                          <RoleBadge role={a.approver_role} />
                          <span className="flex items-center gap-1 text-xs">
                            <ApprovalStateIcon status={a.status} />
                            <span
                              className={cn(
                                a.status === 'approved'
                                  ? 'text-success'
                                  : a.status === 'rejected'
                                    ? 'text-danger'
                                    : 'text-pending',
                              )}
                            >
                              {a.status === 'approved' ? '已通过' : a.status === 'rejected' ? '已驳回' : '待审批'}
                            </span>
                          </span>
                          {a.comment && (
                            <span className="truncate text-xs text-slate-400">「{a.comment}」</span>
                          )}
                          <span className="ml-auto shrink-0 font-mono text-[11px] text-slate-400">
                            {a.target_name}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <div className="h-16 animate-pulse-soft rounded-md bg-slate-100" />
                )}
              </section>

              {/* 我的操作区 / 我的决定 */}
              {isPending ? (
                <div className="rounded-md bg-slate-50 p-3">
                  {actionError && (
                    <div className="mb-2 flex items-center gap-2 text-xs text-danger">
                      <AlertCircle className="size-3.5 shrink-0" />
                      <span className="flex-1">{actionError}</span>
                      <button
                        type="button"
                        onClick={onRetryDecision}
                        className="shrink-0 font-medium text-primary-600 hover:underline"
                      >
                        重试
                      </button>
                    </div>
                  )}
                  <textarea
                    value={comment}
                    onChange={(e) => onCommentChange(e.target.value)}
                    placeholder="审批意见(驳回时必填)…"
                    disabled={submitting || !!morph}
                    className={cn(
                      'h-16 w-full resize-none rounded-md border bg-white px-2.5 py-2 text-[13px] outline-none transition-colors duration-120',
                      'placeholder:text-slate-400 focus:border-primary-600 focus:ring-2 focus:ring-[rgba(13,148,136,0.30)]',
                      commentError ? 'border-danger' : 'border-slate-300',
                    )}
                  />
                  {commentError && (
                    <p className="mt-1 text-xs text-danger">驳回时必须填写审批意见</p>
                  )}
                  <div className="mt-2 flex h-8 items-center justify-end gap-2">
                    {morph ? (
                      <motion.span
                        initial={{ scaleX: 0.6, opacity: 0.6 }}
                        animate={{ scaleX: 1, opacity: 1 }}
                        transition={{ duration: 0.4, ease: 'easeOut' }}
                        className={cn(
                          'flex h-8 origin-right items-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-white',
                          morph === 'approved' ? 'bg-success' : 'bg-danger',
                        )}
                      >
                        {morph === 'approved' ? (
                          <Check className="size-3.5 text-white" />
                        ) : (
                          <X className="size-3.5 text-white" />
                        )}
                        {morph === 'approved' ? '已通过' : '已驳回'}
                      </motion.span>
                    ) : (
                      <>
                        <DecisionConfirm
                          decision="rejected"
                          reportCount={detail?.impacted_reports.length ?? 0}
                          onConfirm={() => onDecide('rejected')}
                        >
                          <Button variant="danger" size="sm" disabled={submitting}>
                            驳回
                          </Button>
                        </DecisionConfirm>
                        <DecisionConfirm
                          decision="approved"
                          reportCount={detail?.impacted_reports.length ?? 0}
                          onConfirm={() => onDecide('approved')}
                        >
                          <Button variant="approve" size="sm" loading={submitting}>
                            通过
                          </Button>
                        </DecisionConfirm>
                      </>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md bg-slate-50 px-3 py-2.5 text-xs text-slate-500">
                  <ApprovalStateIcon status={item.status} />
                  我已于 {relativeTime(item.decided_at)}{' '}
                  {item.status === 'approved' ? '通过' : '驳回'}该审批
                  {item.comment && <span className="text-slate-400">「{item.comment}」</span>}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------- 收件箱 Tab ----------

export function InboxTab() {
  const { user } = useUser()
  const [scope, setScope] = useState<Scope>('mine')
  const [typeFilter, setTypeFilter] = useState<'all' | ChangeType>('all')
  const [sort, setSort] = useState<SortKey>('latest')
  const [items, setItems] = useState<InboxItem[]>([])
  const [mineCount, setMineCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [details, setDetails] = useState<Map<number, ChangeDetailReal>>(new Map())
  const [detailFailed, setDetailFailed] = useState<Set<number>>(new Set())
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [comments, setComments] = useState<Map<number, string>>(new Map())
  const [commentErrors, setCommentErrors] = useState<Set<number>>(new Set())
  const [actionErrors, setActionErrors] = useState<Map<number, string>>(new Map())
  const [submitting, setSubmitting] = useState<Set<number>>(new Set())
  const [morphing, setMorphing] = useState<Map<number, ApprovalDecision>>(new Map())
  // 详情加载去重(避免 Strict 之外的重复请求)
  const detailInflight = useRef<Set<number>>(new Set())
  const lastDecision = useRef<Map<number, ApprovalDecision>>(new Map())
  const timers = useRef<number[]>([])

  useEffect(() => {
    const list = timers.current
    return () => list.forEach((t) => window.clearTimeout(t))
  }, [])

  /** 按需拉取事件详情(影响对象 / diff / 审批人进度) */
  const enrich = useCallback((list: InboxItem[]) => {
    const ids = [...new Set(list.map((i) => i.change_event_id))]
    for (const id of ids) {
      if (detailInflight.current.has(id)) continue
      detailInflight.current.add(id)
      getChange(id)
        .then((d) => {
          const real = d as unknown as ChangeDetailReal
          setDetails((prev) => new Map(prev).set(id, real))
          setDetailFailed((prev) => {
            const next = new Set(prev)
            next.delete(id)
            return next
          })
        })
        .catch(() => {
          setDetailFailed((prev) => new Set(prev).add(id))
        })
        .finally(() => {
          detailInflight.current.delete(id)
        })
    }
  }, [])

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      setError(false)
      try {
        // 待我审批:GET /api/approvals?status=pending&approver=<当前用户>
        if (scope === 'mine') {
          const list = (await listApprovals({
            status: 'pending',
            approver: user,
          })) as unknown as InboxItem[]
          setItems(list)
          setMineCount(list.length)
          enrich(list)
        } else {
          const [list, pending] = await Promise.all([
            listApprovals({ approver: user }) as unknown as Promise<InboxItem[]>,
            listApprovals({ status: 'pending', approver: user }) as unknown as Promise<InboxItem[]>,
          ])
          setItems(scope === 'done' ? list.filter((i) => i.status !== 'pending') : list)
          setMineCount(pending.length)
          enrich(list)
        }
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    },
    [scope, user, enrich],
  )

  useEffect(() => {
    void load()
  }, [load])

  const visible = useMemo(() => {
    let list = items
    if (typeFilter !== 'all') {
      list = list.filter((i) => i.change_event?.change_type === typeFilter)
    }
    return [...list].sort((a, b) => {
      if (sort === 'impact') {
        return impactTotal(details.get(b.change_event_id)) - impactTotal(details.get(a.change_event_id))
      }
      const ta = new Date(a.change_event?.created_at ?? 0).getTime()
      const tb = new Date(b.change_event?.created_at ?? 0).getTime()
      return tb - ta
    })
  }, [items, typeFilter, sort, details])

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
    // 展开时恢复评论草稿
    setComments((prev) => {
      if (prev.has(id)) return prev
      return new Map(prev).set(id, loadCommentDraft(id))
    })
  }

  const decide = async (item: InboxItem, decision: ApprovalDecision) => {
    if (submitting.has(item.id) || morphing.has(item.id)) return
    const comment = (comments.get(item.id) ?? '').trim()
    if (decision === 'rejected' && !comment) {
      setCommentErrors((prev) => new Set(prev).add(item.id))
      return
    }
    lastDecision.current.set(item.id, decision)
    setSubmitting((prev) => new Set(prev).add(item.id))
    setActionErrors((prev) => {
      const next = new Map(prev)
      next.delete(item.id)
      return next
    })
    try {
      const event = await decideApproval(item.id, { decision, comment: comment || undefined })
      clearCommentDraft(item.id)
      notifyApprovalsChanged()
      // 计算剩余待审批人数(用于 Toast 文案)
      let remaining = 0
      try {
        const detail = (await getChange(item.change_event_id)) as unknown as ChangeDetailReal
        remaining = detail.approvals.filter((a) => a.status === 'pending').length
        setDetails((prev) => new Map(prev).set(item.change_event_id, detail))
      } catch {
        /* 仅影响 Toast 文案,忽略 */
      }
      // 按钮状态形变(design.md §8.3)→ 400ms 后条目从列表移除(exit:height→0 + opacity 300ms)→ Toast
      setMorphing((prev) => new Map(prev).set(item.id, decision))
      timers.current.push(
        window.setTimeout(() => {
          setItems((prev) => prev.filter((i) => i.id !== item.id))
          timers.current.push(
            window.setTimeout(() => {
              setMorphing((prev) => {
                const next = new Map(prev)
                next.delete(item.id)
                return next
              })
              if (decision === 'approved') {
                if (event.status === 'approved') {
                  toast.success('全员已通过,变更已生效', formatChangeId(event.id))
                } else {
                  toast.success(
                    `已通过 ${formatChangeId(item.change_event_id)}`,
                    `剩余 ${remaining} 人待审批`,
                  )
                }
              } else {
                toast.info(`已驳回 ${formatChangeId(item.change_event_id)}`, '其余待审批任务已关闭')
              }
              void load(true)
            }, 300),
          )
        }, 400),
      )
    } catch (e) {
      setActionErrors((prev) =>
        new Map(prev).set(item.id, e instanceof Error ? e.message : '操作失败,请重试'),
      )
    } finally {
      setSubmitting((prev) => {
        const next = new Set(prev)
        next.delete(item.id)
        return next
      })
    }
  }

  const scopeMeta = SCOPE_META[scope]

  return (
    <div>
      {/* 工具条 */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5">
          {(Object.keys(SCOPE_META) as Scope[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setScope(key)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors duration-120',
                scope === key
                  ? 'border-primary-600 bg-primary-50 text-primary-700'
                  : 'border-slate-200 bg-white text-slate-500 hover:text-slate-900',
              )}
            >
              {SCOPE_META[key].label}
              {key === 'mine' && mineCount !== null && mineCount > 0 && (
                <span className="rounded bg-pending px-1 text-[11px] leading-4 text-white">
                  {mineCount}
                </span>
              )}
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
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="h-8 w-[148px] border-slate-300 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="latest">最新优先</SelectItem>
              <SelectItem value="impact">影响面最大优先</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* 列表 */}
      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[104px] animate-pulse-soft rounded-lg border border-slate-200 bg-slate-100" />
          ))}
        </div>
      ) : error ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white py-16 text-xs text-danger">
          <AlertCircle className="size-3.5" />
          审批列表加载失败
          <button type="button" onClick={() => void load()} className="text-primary-600 hover:underline">
            重试
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white">
          <EmptyState
            image="/empty-approval.svg"
            title={typeFilter !== 'all' ? '该类型下没有审批' : scopeMeta.emptyTitle}
            description={typeFilter !== 'all' ? '切换类型筛选查看其他审批' : scopeMeta.emptyDesc}
          />
        </div>
      ) : (
        <div className="space-y-3">
          <AnimatePresence initial={false}>
            {visible.map((item, index) => (
              <motion.div
                key={item.id}
                layout="position"
                variants={{
                  enter: (i: number) => ({
                    opacity: 1,
                    y: 0,
                    transition: {
                      duration: 0.24,
                      delay: Math.min(i, 15) * 0.03,
                      ease: [0.22, 1, 0.36, 1] as [number, number, number, number],
                    },
                  }),
                  exit: {
                    opacity: 0,
                    height: 0,
                    transition: { duration: 0.3, ease: 'easeOut' as const },
                  },
                }}
                custom={index}
                initial={{ opacity: 0, y: 6 }}
                animate="enter"
                exit="exit"
                className="overflow-hidden"
              >
                <ApprovalCard
                  item={item}
                  detail={details.get(item.change_event_id)}
                  detailFailed={detailFailed.has(item.change_event_id)}
                  expanded={expanded.has(item.id)}
                  morph={morphing.get(item.id)}
                  submitting={submitting.has(item.id)}
                  actionError={actionErrors.get(item.id)}
                  commentError={commentErrors.has(item.id)}
                  comment={comments.get(item.id) ?? ''}
                  onToggle={() => toggle(item.id)}
                  onRetryDetail={() => enrich([item])}
                  onDecide={(decision) => void decide(item, decision)}
                  onRetryDecision={() => {
                    const last = lastDecision.current.get(item.id)
                    if (last) void decide(item, last)
                  }}
                  onCommentChange={(value) => {
                    setComments((prev) => new Map(prev).set(item.id, value))
                    saveCommentDraft(item.id, value)
                    if (commentErrors.has(item.id) && value.trim()) {
                      setCommentErrors((prev) => {
                        const next = new Set(prev)
                        next.delete(item.id)
                        return next
                      })
                    }
                  }}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

