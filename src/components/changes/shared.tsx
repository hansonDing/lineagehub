/**
 * 变更与审批中心 — 页面内共享小组件
 * 仅服务于 src/pages/Changes.tsx 与 src/components/changes/*
 */

import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  Clock,
  Search,
  Send,
  Table2,
  X,
} from 'lucide-react'
import { animate, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { ApproverRole, ChangeDiff, ChangeStatus, ChangeType, ColumnDiffEntry } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { columnNewType, columnOldType } from './types'

// ---------- 数字计数(400ms easeOut,仅首屏) ----------

export function CountUp({ value, duration = 0.4 }: { value: number; duration?: number }) {
  const [display, setDisplay] = useState(0)
  const currentRef = useRef(0)
  useEffect(() => {
    const controls = animate(currentRef.current, value, {
      duration,
      ease: 'easeOut',
      onUpdate: (v) => {
        currentRef.current = v
        setDisplay(Math.round(v))
      },
    })
    return () => controls.stop()
  }, [value, duration])
  return <span className="tabular-nums">{display}</span>
}

// ---------- 角色徽标(主色浅底) ----------

const KNOWN_ROLES: ApproverRole[] = ['report_owner', 'system_owner', 'table_owner']

export function RoleBadge({ role, className }: { role: ApproverRole | string; className?: string }) {
  const { t } = useT()
  const label = KNOWN_ROLES.includes(role as ApproverRole) ? t(`common.role.${role}`) : role
  return (
    <span
      className={cn(
        'inline-flex items-center rounded bg-primary-50 px-1.5 text-[11px] font-medium leading-4 text-primary-700',
        className,
      )}
    >
      {label}
    </span>
  )
}

// ---------- 字段 diff 小表(changes.md §2.2 展开区) ----------

type DiffKind = 'added' | 'removed' | 'type_changed'

const DIFF_KIND_META: Record<DiffKind, { labelKey: string; className: string }> = {
  added: { labelKey: 'changes.diff.kind.added', className: 'bg-success-light text-success' },
  removed: { labelKey: 'changes.diff.kind.removed', className: 'bg-danger-light text-danger' },
  type_changed: { labelKey: 'changes.diff.kind.typeChanged', className: 'bg-pending-light text-pending' },
}

function DiffKindBadge({ kind }: { kind: DiffKind }) {
  const { t } = useT()
  const meta = DIFF_KIND_META[kind]
  return (
    <span className={cn('inline-flex items-center rounded px-1.5 text-[11px] font-medium leading-4', meta.className)}>
      {t(meta.labelKey)}
    </span>
  )
}

export function FieldDiffTable({ diff }: { diff: ChangeDiff }) {
  const { t } = useT()
  const rows: { entry: ColumnDiffEntry; kind: DiffKind }[] = [
    ...(diff.added ?? []).map((entry) => ({ entry, kind: 'added' as DiffKind })),
    ...(diff.removed ?? []).map((entry) => ({ entry, kind: 'removed' as DiffKind })),
    ...(diff.type_changed ?? []).map((entry) => ({ entry, kind: 'type_changed' as DiffKind })),
  ]
  if (rows.length === 0) return null
  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <table className="w-full border-collapse text-left">
        <thead>
          <tr className="h-8 border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
            <th className="px-3">{t('changes.diff.col.name')}</th>
            <th className="px-3">{t('changes.diff.col.type')}</th>
            <th className="px-3">{t('changes.diff.col.beforeAfter')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ entry, kind }, i) => (
            <tr
              key={`${kind}-${entry.name}-${i}`}
              className="h-9 border-b border-slate-100 text-[13px] last:border-b-0"
            >
              <td className="px-3 font-mono text-slate-900">{entry.name}</td>
              <td className="px-3">
                <DiffKindBadge kind={kind} />
              </td>
              <td className="px-3 font-mono text-xs text-slate-500">
                {kind === 'added' && (
                  <>
                    <span className="text-slate-300">—</span>
                    <ArrowRight className="mx-1 inline size-3 text-slate-400" />
                    <span className="text-success">{columnNewType(entry) || '—'}</span>
                  </>
                )}
                {kind === 'removed' && (
                  <>
                    <span className="text-danger line-through">{columnOldType(entry) || '—'}</span>
                    <ArrowRight className="mx-1 inline size-3 text-slate-400" />
                    <span className="text-slate-300">—</span>
                  </>
                )}
                {kind === 'type_changed' && (
                  <>
                    <span>{columnOldType(entry) || '—'}</span>
                    <ArrowRight className="mx-1 inline size-3 text-slate-400" />
                    <span className="text-pending">{columnNewType(entry) || '—'}</span>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------- 血缘边 diff(SQL 变更) ----------

export function EdgeDiffList({ diff }: { diff: ChangeDiff }) {
  const added = diff.edges_added ?? []
  const removed = diff.edges_removed ?? []
  if (added.length === 0 && removed.length === 0) return null
  return (
    <div className="space-y-1 font-mono text-xs">
      {added.map((e, i) => (
        <div
          key={`a-${i}`}
          className="flex items-center gap-2 rounded bg-success-light px-2.5 py-1.5 text-success"
        >
          <span className="font-sans font-medium">+</span>
          {e.source} <ArrowRight className="size-3" /> {e.target}
        </div>
      ))}
      {removed.map((e, i) => (
        <div
          key={`r-${i}`}
          className="flex items-center gap-2 rounded bg-danger-light px-2.5 py-1.5 text-danger line-through"
        >
          <span className="font-sans font-medium no-underline">-</span>
          {e.source} <ArrowRight className="size-3" /> {e.target}
        </div>
      ))}
    </div>
  )
}

/** 按变更类型渲染结构化 diff(字段表 / 血缘边;create/drop 表两者兼有,组件空数据自动隐藏) */
export function ChangeDiffView({ type, diff }: { type: ChangeType; diff: ChangeDiff }) {
  if (type === 'sql_change') return <EdgeDiffList diff={diff} />
  return (
    <div className="space-y-3">
      <FieldDiffTable diff={diff} />
      <EdgeDiffList diff={diff} />
    </div>
  )
}

// ---------- 影响摘要 chips(12px 无底色,图标区分) ----------

export function ImpactChips({
  reports,
  systems,
  tables,
  className,
}: {
  reports: string[]
  systems: string[]
  tables: string[]
  className?: string
}) {
  const { t } = useT()
  const sep = t('changes.impact.nameSep')
  const segments: { icon: typeof BarChart3; label: string; names: string[] }[] = [
    { icon: BarChart3, label: t('changes.impact.reports'), names: reports },
    { icon: Send, label: t('changes.impact.systems'), names: systems },
    { icon: Table2, label: t('changes.impact.tables'), names: tables },
  ]
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500', className)}>
      {segments.map(({ icon: Icon, label, names }) => (
        <span key={label} className="inline-flex items-center gap-1" title={names.join(sep)}>
          <Icon className="size-3.5 text-slate-400" />
          {label}×{names.length}
          {names.length > 0 && (
            <span className="max-w-[220px] truncate text-slate-400">({names.join(sep)})</span>
          )}
        </span>
      ))}
    </div>
  )
}

// ---------- 审批进度环(32px,琥珀底环 + 绿色进度弧) ----------

export function ProgressRing({ approved, total }: { approved: number; total: number }) {
  const { t } = useT()
  const size = 32
  const stroke = 3
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const ratio = total > 0 ? approved / total : 0
  return (
    <span
      className="relative inline-flex size-8 shrink-0 items-center justify-center"
      title={t('changes.progress.title', { approved, total })}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#FDE8C8" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#16A34A"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - ratio) }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </svg>
      <span className="absolute font-mono text-[10px] font-medium text-slate-700 tabular-nums">
        {approved}/{total}
      </span>
    </span>
  )
}

// ---------- 状态步进器(已提交 → 影响分析 → 审批中 → 已生效/已驳回) ----------

export function StatusStepper({ status }: { status: ChangeStatus | string }) {
  const { t } = useT()
  const finalLabel = status === 'rejected' ? t('common.status.rejected') : t('common.status.effective')
  const steps = [t('changes.stepper.submitted'), t('changes.impact.title'), t('common.status.approving'), finalLabel]
  // current:当前进行中的步骤下标;doneBefore:其前步骤全部完成
  const current = status === 'pending' ? 2 : 3
  return (
    <div className="flex items-center">
      {steps.map((label, i) => {
        const done = status === 'approved' ? true : i < current
        const isCurrent = status === 'pending' && i === current
        const isRejectedFinal = status === 'rejected' && i === 3
        return (
          <div key={label} className={cn('flex items-center', i > 0 && 'flex-1')}>
            {i > 0 && (
              <motion.span
                className="mx-2 h-0.5 flex-1 origin-left"
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.4, delay: i * 0.12, ease: 'easeOut' }}
                style={{ backgroundColor: done || isRejectedFinal ? '#16A34A' : '#E2E8F0' }}
              />
            )}
            <div className="flex shrink-0 flex-col items-center gap-1.5">
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full',
                  done && 'bg-success text-white',
                  isCurrent && 'bg-pending-light text-pending',
                  !done && !isCurrent && !isRejectedFinal && 'border border-slate-200 bg-white text-slate-300',
                  isRejectedFinal && 'bg-danger text-white',
                )}
                style={isCurrent ? { animation: 'pulse-soft 1.6s ease-in-out infinite' } : undefined}
              >
                {done ? (
                  <Check className="size-3" />
                ) : isRejectedFinal ? (
                  <X className="size-3" />
                ) : isCurrent ? (
                  <Clock className="size-3" />
                ) : (
                  <span className="size-1.5 rounded-full bg-slate-300" />
                )}
              </span>
              <span
                className={cn(
                  'text-[11px] leading-none',
                  done ? 'font-medium text-success' : isCurrent ? 'font-medium text-pending' : isRejectedFinal ? 'font-medium text-danger' : 'text-slate-400',
                )}
              >
                {label}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------- 搜索选择器(选择表 / 选择脚本) ----------

export interface SearchSelectOption {
  value: string
  /** 主文案(等宽展示) */
  label: string
  /** 右侧附加内容(如 LayerBadge / 版本徽标) */
  trailing?: ReactNode
}

export function SearchSelect({
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  disabled,
  className,
}: {
  value: string
  onChange: (value: string) => void
  options: SearchSelectOption[]
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  className?: string
}) {
  const { t } = useT()
  const resolvedPlaceholder = placeholder ?? t('changes.searchSelect.placeholder')
  const resolvedSearchPlaceholder = searchPlaceholder ?? t('changes.searchSelect.searchPlaceholder')
  const [open, setOpen] = useState(false)
  const [keyword, setKeyword] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selected = options.find((o) => o.value === value)
  const filtered = keyword
    ? options.filter((o) => o.label.toLowerCase().includes(keyword.toLowerCase()))
    : options

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setOpen((v) => !v)
          setKeyword('')
        }}
        className={cn(
          'flex h-8 w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-2.5 text-[13px] transition-colors duration-120',
          'outline-none focus:border-primary-600 focus:ring-2 focus:ring-[rgba(13,148,136,0.30)]',
          'disabled:cursor-not-allowed disabled:opacity-40',
          open && 'border-primary-600 ring-2 ring-[rgba(13,148,136,0.30)]',
        )}
      >
        {selected ? (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-mono text-slate-900">{selected.label}</span>
            {selected.trailing}
          </span>
        ) : (
          <span className="text-slate-400">{resolvedPlaceholder}</span>
        )}
        <ChevronDown className="size-3.5 shrink-0 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-9 z-30 overflow-hidden rounded-md border border-slate-200 bg-white shadow-overlay">
          <div className="flex items-center gap-1.5 border-b border-slate-100 px-2.5 py-2">
            <Search className="size-3.5 shrink-0 text-slate-400" />
            <input
              autoFocus
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={resolvedSearchPlaceholder}
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-slate-400"
            />
          </div>
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-center text-xs text-slate-400">{t('changes.searchSelect.empty')}</p>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => {
                    onChange(o.value)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[13px] transition-colors duration-120 hover:bg-slate-50',
                    o.value === value && 'bg-primary-50',
                  )}
                >
                  <span className="truncate font-mono text-slate-900">{o.label}</span>
                  {o.trailing}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- 审批人状态图标 ----------

export function ApprovalStateIcon({ status }: { status: string }) {
  if (status === 'approved') return <Check className="size-3.5 text-success" />
  if (status === 'rejected') return <X className="size-3.5 text-danger" />
  return <Clock className="size-3.5 text-pending" />
}
