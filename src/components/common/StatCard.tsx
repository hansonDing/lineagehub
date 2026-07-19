import { useEffect, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { formatNumber } from '@/lib/format'

/**
 * StatCard 统计卡(design.md §9.12)
 * 白底圆角 8px,16px 20px;标签 12px + 右侧 16px 弱图标;大数字 28px 等宽计数动画
 * 600ms easeOutCubic(仅首屏);环比徽标 + 72×24 迷你折线描边绘入 800ms
 */

/** 从 0 计数至目标值,600ms easeOutCubic */
export function useCountUp(target: number, duration = 600): number {
  const [value, setValue] = useState(0)
  const fromRef = useRef(0)
  useEffect(() => {
    const from = fromRef.current
    if (from === target) {
      setValue(target)
      return
    }
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
      const current = Math.round(from + (target - from) * eased)
      setValue(current)
      if (t < 1) {
        raf = requestAnimationFrame(tick)
      } else {
        fromRef.current = target
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration])
  return value
}

/** 7 日迷你趋势线:72×24,1.5px 折线,无填充无坐标轴,首屏描边绘入 */
export function Sparkline({
  data,
  color = '#0D9488',
  width = 72,
  height = 24,
  animate = true,
}: {
  data: number[]
  color?: string
  width?: number
  height?: number
  animate?: boolean
}) {
  if (data.length < 2) {
    return <svg width={width} height={height} aria-hidden />
  }
  const max = Math.max(...data)
  const min = Math.min(...data)
  const range = max - min || 1
  const pad = 2
  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (width - pad * 2)
    const y = height - pad - ((v - min) / range) * (height - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const d = `M${points.join(' L')}`
  return (
    <svg width={width} height={height} aria-hidden className="shrink-0">
      <motion.path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={animate ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.8, delay: 0.1, ease: 'easeOut' }}
      />
    </svg>
  )
}

export interface StatCardProps {
  label: string
  icon: LucideIcon
  value: number
  /** 环比文案,如 '+6 本周';>0 绿、0 灰 */
  delta?: string
  deltaTone?: 'up' | 'flat'
  /** 构成提示,如「其中 ADS 层 12 张」 */
  hint?: string
  /** 7 日趋势线数据 */
  spark?: number[]
  onClick?: () => void
}

export function StatCard({ label, icon: Icon, value, delta, deltaTone, hint, spark, onClick }: StatCardProps) {
  const display = useCountUp(value)
  const tone = deltaTone ?? (delta && !delta.startsWith('0') ? 'up' : 'flat')
  return (
    <div
      onClick={onClick}
      className={cn(
        'rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-card transition-colors duration-120',
        onClick && 'cursor-pointer hover:border-slate-300',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{label}</span>
        <Icon className="size-4 text-slate-400" />
      </div>
      <div className="mt-2 font-mono text-[28px] font-semibold leading-[34px] text-slate-900">
        {formatNumber(display)}
      </div>
      <div className="mt-2 flex items-center justify-between">
        {delta !== undefined ? (
          <span
            className={cn(
              'rounded px-1 text-[11px] leading-4',
              tone === 'up' ? 'bg-success-light text-success' : 'bg-slate-100 text-slate-500',
            )}
          >
            {delta}
          </span>
        ) : (
          <span />
        )}
        {spark && <Sparkline data={spark} />}
      </div>
      {hint && <div className="mt-2 border-t border-slate-100 pt-2 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}
