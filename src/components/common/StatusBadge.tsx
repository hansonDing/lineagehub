import { FileCode2, FileDiff, PlusCircle, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChangeType } from '@/lib/api'
import { useT } from '@/lib/i18n'

/**
 * StatusBadge 状态徽标(design.md §9.2)
 * 高 20px,padding 0 8px,圆角 4px,11px 500,浅底 + 同色文字 + 左侧 5px 状态点
 */

type Tone = 'success' | 'pending' | 'danger' | 'warning' | 'info' | 'neutral'

const TONE_STYLES: Record<Tone, { bg: string; text: string; dot: string }> = {
  success: { bg: 'bg-success-light', text: 'text-success', dot: '#16A34A' },
  pending: { bg: 'bg-pending-light', text: 'text-pending', dot: '#D97706' },
  danger: { bg: 'bg-danger-light', text: 'text-danger', dot: '#DC2626' },
  warning: { bg: 'bg-sqlwarn-light', text: 'text-sqlwarn', dot: '#EA580C' },
  info: { bg: 'bg-info-light', text: 'text-info', dot: '#2563EB' },
  neutral: { bg: 'bg-slate-100', text: 'text-slate-500', dot: '#94A3B8' },
}

/** 语义状态 → 色调 映射(文案走 i18n `common.status.*`;不在映射表内时状态键原样显示,色调 neutral) */
const STATUS_TONES: Record<string, Tone> = {
  pending: 'pending',
  approving: 'pending',
  approved: 'success',
  effective: 'success',
  rejected: 'danger',
  parsed: 'success',
  parsing: 'info',
  parse_failed: 'danger',
  warning: 'warning',
  running: 'success',
  paused: 'neutral',
}

export interface StatusBadgeProps {
  /** 语义状态键;不在映射表内时作为文案直接显示,色调 neutral */
  status: string
  /** 覆盖默认文案 */
  label?: string
  /** 是否隐藏左侧状态点 */
  hideDot?: boolean
  className?: string
}

export function StatusBadge({ status, label, hideDot, className }: StatusBadgeProps) {
  const { t } = useT()
  const known = status in STATUS_TONES
  const tone = known ? STATUS_TONES[status] : 'neutral'
  const styles = TONE_STYLES[tone]
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1.5 rounded px-2 text-[11px] font-medium leading-none',
        styles.bg,
        styles.text,
        className,
      )}
    >
      {!hideDot && (
        <span
          className="size-[5px] shrink-0 rounded-full"
          style={{ backgroundColor: styles.dot }}
        />
      )}
      {label ?? (known ? t(`common.status.${status}`) : status)}
    </span>
  )
}

/** 变更类型徽标:DDL 变更(FileDiff)/ SQL 变更(FileCode2),slate 底 */
export function ChangeTypeBadge({ type, className }: { type: ChangeType; className?: string }) {
  const { t } = useT()
  const Icon =
    type === 'ddl_change'
      ? FileDiff
      : type === 'create_table'
        ? PlusCircle
        : type === 'drop_table'
          ? Trash2
          : FileCode2
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded bg-slate-100 px-1.5 text-[11px] font-medium text-slate-600',
        className,
      )}
    >
      <Icon className="size-3" />
      {t(`common.changeType.${type}`)}
    </span>
  )
}
