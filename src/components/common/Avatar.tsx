import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'

/**
 * Avatar 首字母头像(design.md §9.13)
 * 圆形,取姓名末字;底色按姓名 hash 轮换;多人叠放 -6px 偏移 + 2px 白描边
 */

const PALETTE = ['#0F766E', '#4E8FD9', '#9C8E7E', '#3FA97C', '#8A94A6']

function hashName(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) >>> 0
  }
  return h
}

export interface AvatarProps {
  name: string
  /** 列表 28 / 行内 24 / 详情 32 */
  size?: 24 | 28 | 32
  /** 叠放模式:添加 2px 白描边,配合父级 -space-x-1.5 使用 */
  stacked?: boolean
  className?: string
  style?: CSSProperties
}

export function Avatar({ name, size = 28, stacked, className, style }: AvatarProps) {
  const initial = name.trim().slice(-1) || '?'
  const bg = PALETTE[hashName(name) % PALETTE.length]
  return (
    <span
      title={name}
      style={{
        width: size,
        height: size,
        backgroundColor: bg,
        fontSize: 11,
        boxShadow: stacked ? '0 0 0 2px #FFFFFF' : undefined,
        ...style,
      }}
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium text-white',
        className,
      )}
    >
      {initial}
    </span>
  )
}
