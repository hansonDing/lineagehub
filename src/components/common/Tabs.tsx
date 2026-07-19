import { useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Tabs 下划线标签页(design.md §9.7)
 * 标签 14px 500 #64748B;选中 #0F766E + 2px 下划线滑动 180ms;右侧计数徽标
 */

export interface TabItem {
  key: string
  label: string
  /** 右侧计数;undefined 不显示 */
  count?: number
  /** 待办类计数用琥珀底白字 */
  countTone?: 'neutral' | 'pending'
}

export function Tabs({
  items,
  value,
  onChange,
  className,
}: {
  items: TabItem[]
  value: string
  onChange: (key: string) => void
  className?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState({ left: 0, width: 0 })

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const active = container.querySelector<HTMLButtonElement>(`[data-tab-key="${CSS.escape(value)}"]`)
    if (active) {
      setIndicator({ left: active.offsetLeft, width: active.offsetWidth })
    }
  }, [value, items])

  return (
    <div ref={containerRef} className={cn('relative flex items-center gap-6 border-b border-slate-200', className)}>
      {items.map((item) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            data-tab-key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={cn(
              'relative flex items-center gap-1.5 px-1 py-2 text-sm font-medium transition-colors duration-120',
              active ? 'text-primary-700' : 'text-slate-500 hover:text-slate-900',
            )}
          >
            {item.label}
            {item.count !== undefined && (
              <span
                className={cn(
                  'rounded px-1 text-[11px] leading-4',
                  item.countTone === 'pending' && item.count > 0
                    ? 'bg-pending text-white'
                    : 'bg-slate-100 text-slate-500',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        )
      })}
      {/* 滑动下划线 */}
      <span
        className="absolute bottom-0 h-0.5 bg-primary-700 transition-all duration-180"
        style={{ left: indicator.left, width: indicator.width, transitionTimingFunction: 'ease' }}
      />
    </div>
  )
}
