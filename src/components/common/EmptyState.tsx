import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * EmptyState 空态(design.md §9.10)
 * SVG 插画(200×133 展示)+ 标题 14px 600 #334155 + 说明 13px #64748B + 可选主操作
 */
export function EmptyState({
  image,
  title,
  description,
  action,
  className,
}: {
  /** 插画路径,如 /empty-approval.svg;省略时显示占位图形 */
  image?: string
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center px-6 py-10 text-center',
        className,
      )}
    >
      {image ? (
        <img src={image} alt="" width={200} height={133} className="mb-4" />
      ) : (
        <svg width="200" height="133" viewBox="0 0 200 133" fill="none" className="mb-4">
          <rect x="60" y="36" width="80" height="60" rx="8" stroke="#CBD5E1" strokeWidth="2" strokeDasharray="5 5" />
        </svg>
      )}
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {description && <p className="mt-1 max-w-[320px] text-[13px] text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
