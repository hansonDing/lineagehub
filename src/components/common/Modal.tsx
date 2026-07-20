import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'

/**
 * Modal 模态(design.md §9.6 + §8.5)
 * 宽 560px(表单)/ 720px(影响分析),圆角 10px,头部 16px 600,
 * 遮罩 rgba(15,23,42,0.45);入场 scale 0.97→1 + opacity 180ms
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 560,
  danger = false,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  footer?: ReactNode
  width?: 560 | 720
  /** 危险操作(删除确认):标题红色 */
  danger?: boolean
}) {
  const { t } = useT()
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-16">
          <motion.div
            key="mask"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="fixed inset-0 bg-[rgba(15,23,42,0.45)]"
          />
          <motion.div
            key="panel"
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.18 }}
            style={{ width }}
            className="relative z-10 flex max-h-[calc(100dvh-8rem)] flex-col rounded-[10px] bg-white shadow-modal"
          >
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 px-5">
              <h2 className={cn('text-base font-semibold', danger ? 'text-danger' : 'text-slate-900')}>
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label={t('common.close')}
                className="rounded p-1 text-slate-400 transition-colors duration-120 hover:text-slate-900"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">{children}</div>
            {footer && (
              <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
