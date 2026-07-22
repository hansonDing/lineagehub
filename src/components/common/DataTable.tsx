import type { ReactNode } from 'react'
import { ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { EmptyState } from './EmptyState'

/**
 * DataTable 数据表格(design.md §9.4)
 * 容器:白底圆角 8px 边框 #E2E8F0 卡片阴影;表头 #F8FAFC 12px 500 #64748B 行高 36px;
 * 行高 44px 下边框 #F1F5F9 13px,hover #F8FAFC;空态行高 ≥240px
 */

export interface Column<T> {
  key: string
  title: ReactNode
  render?: (row: T, index: number) => ReactNode
  width?: number | string
  align?: 'left' | 'right' | 'center'
  /** 表名/ID 列:等宽 13px */
  mono?: boolean
  /** 显示排序图标(纯展示,排序逻辑由调用方处理) */
  sortable?: boolean
  onSort?: () => void
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  rowKey: (row: T) => string | number
  loading?: boolean
  onRowClick?: (row: T) => void
  emptyImage?: string
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: ReactNode
  /** 底部分页区(自定义渲染);传 true 显示「共 N 条」 */
  footer?: ReactNode | true
  className?: string
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  rowKey,
  loading,
  onRowClick,
  emptyImage,
  emptyTitle,
  emptyDescription,
  emptyAction,
  footer,
  className,
}: DataTableProps<T>) {
  const { t } = useT()
  return (
    <div className={cn('overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card', className)}>
      {/* 窄屏横向滚动:表格保持最小宽度不挤压变形 */}
      <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="h-9 border-b border-slate-200 bg-slate-50">
            {columns.map((col) => (
              <th
                key={col.key}
                style={{ width: col.width, textAlign: col.align ?? 'left' }}
                className="px-3 text-xs font-medium text-slate-500"
              >
                <span className="inline-flex items-center gap-1">
                  {col.title}
                  {col.sortable && (
                    <button
                      type="button"
                      onClick={col.onSort}
                      className="text-slate-400 transition-colors hover:text-slate-700"
                      aria-label={t('common.table.sort')}
                    >
                      <ArrowUpDown className="size-3" />
                    </button>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <tr key={i} className="h-11 border-b border-slate-100">
                {columns.map((col) => (
                  <td key={col.key} className="px-3">
                    <div className="h-3.5 animate-pulse-soft rounded bg-slate-100" style={{ width: `${70 - i * 12}%` }} />
                  </td>
                ))}
              </tr>
            ))
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <EmptyState
                  image={emptyImage}
                  title={emptyTitle ?? t('common.empty.title')}
                  description={emptyDescription}
                  action={emptyAction}
                  className="min-h-60"
                />
              </td>
            </tr>
          ) : (
            data.map((row, index) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn(
                  'h-11 border-b border-slate-100 text-[13px] text-slate-900 transition-colors duration-120 last:border-b-0 hover:bg-slate-50',
                  onRowClick && 'cursor-pointer',
                )}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    style={{ textAlign: col.align ?? 'left' }}
                    className={cn('px-3', col.mono && 'font-mono text-[13px] text-slate-900')}
                  >
                    {col.render ? col.render(row, index) : String(row[col.key] ?? '-')}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>
      {footer && (
        <div className="flex h-10 items-center justify-end gap-2 border-t border-slate-200 px-3 text-xs text-slate-500">
          {footer === true ? t('common.table.total', { count: data.length }) : footer}
        </div>
      )}
    </div>
  )
}
