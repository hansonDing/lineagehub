import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import type { TableLayer } from '@/lib/api'
import { LAYER_COLORS } from '@/lib/format'

/**
 * LayerBadge 分层徽标(design.md §9.3)
 * 等宽大写 11px,层色 8% 底 + 层色文字(深色背景 16% 底),圆角 4px,padding 1px 6px
 */
export function LayerBadge({
  layer,
  dark = false,
  className,
}: {
  layer: TableLayer | string
  dark?: boolean
  className?: string
}) {
  const color = LAYER_COLORS[(layer as TableLayer) in LAYER_COLORS ? (layer as TableLayer) : 'other']
  const style: CSSProperties = {
    color,
    backgroundColor: `${color}${dark ? '29' : '14'}`, // 8% ≈ 14 hex,16% ≈ 29 hex
  }
  return (
    <span
      style={style}
      className={cn(
        'inline-flex items-center rounded px-1.5 py-px font-mono text-[11px] font-medium uppercase leading-4',
        className,
      )}
    >
      {layer}
    </span>
  )
}
