import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'

/**
 * Toast 轻量管理器(design.md §9.11 + §8.3)
 * 右上角堆叠,宽 320px,白底圆角 8px 浮层阴影;入场 translateX 16px→0 + opacity,200ms;停留 3s 自动消失
 *
 * 用法:
 *   import { toast, Toaster } from '@/components/common/Toast'
 *   <Toaster />  // 挂在 Layout 一次
 *   toast.success('已通过', '变更 #CHG-1042 已生效')
 */

export type ToastTone = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  tone: ToastTone
  title: string
  description?: string
}

type Listener = (items: ToastItem[]) => void

let items: ToastItem[] = []
let seq = 0
const listeners = new Set<Listener>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

function emit() {
  for (const fn of listeners) fn([...items])
}

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id)
  const timer = timers.get(id)
  if (timer) clearTimeout(timer)
  timers.delete(id)
  emit()
}

function push(tone: ToastTone, title: string, description?: string): number {
  const id = ++seq
  items = [...items, { id, tone, title, description }].slice(-5)
  timers.set(id, setTimeout(() => dismiss(id), 3000))
  emit()
  return id
}

export const toast = {
  success: (title: string, description?: string) => push('success', title, description),
  error: (title: string, description?: string) => push('error', title, description),
  info: (title: string, description?: string) => push('info', title, description),
  dismiss,
}

const TONE_CONFIG: Record<ToastTone, { icon: typeof CheckCircle2; className: string }> = {
  success: { icon: CheckCircle2, className: 'text-success' },
  error: { icon: AlertCircle, className: 'text-danger' },
  info: { icon: Info, className: 'text-info' },
}

/** 挂一次(建议 Layout 内),渲染右上角 Toast 堆叠 */
export function Toaster() {
  const { t } = useT()
  const [current, setCurrent] = useState<ToastItem[]>([])

  useEffect(() => {
    const listener: Listener = (next) => setCurrent(next)
    listeners.add(listener)
    setCurrent([...items])
    return () => {
      listeners.delete(listener)
    }
  }, [])

  return (
    <div className="pointer-events-none fixed right-4 top-16 z-[100] flex w-80 flex-col gap-2">
      <AnimatePresence initial={false}>
        {current.map((item) => {
          const config = TONE_CONFIG[item.tone]
          const Icon = config.icon
          return (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white p-3 shadow-overlay"
            >
              <Icon className={cn('mt-px size-4 shrink-0', config.className)} />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-slate-900">{item.title}</p>
                {item.description && (
                  <p className="mt-0.5 break-words text-xs text-slate-500">{item.description}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismiss(item.id)}
                className="rounded p-0.5 text-slate-400 transition-colors hover:text-slate-900"
                aria-label={t('common.close')}
              >
                <X className="size-3.5" />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
