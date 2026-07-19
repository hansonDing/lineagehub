import type { ReactNode } from 'react'
import { useEffect } from 'react'
import { X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { cn } from '@/lib/utils'

/**
 * Drawer 右侧抽屉(design.md §9.5 + §8.5)
 * 默认宽 480px(血缘画布详情抽屉 400px 深色),全高右滑入 280ms;
 * 遮罩 rgba(15,23,42,0.30),点击遮罩/Esc 关闭;底部固定操作条
 */
export function Drawer({
  open,
  onClose,
  title,
  children,
  footer,
  width = 480,
  dark = false,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
  /** 底部固定操作条内容(主操作右对齐) */
  footer?: ReactNode
  width?: number
  /** 深色变体(血缘画布详情抽屉) */
  dark?: boolean
}) {
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
        <>
          <motion.div
            key="mask"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-[rgba(15,23,42,0.30)]"
          />
          <motion.aside
            key="panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
            style={{ width }}
            className={cn(
              'fixed inset-y-0 right-0 z-50 flex flex-col shadow-overlay',
              dark ? 'bg-ink text-slate-200' : 'bg-white text-slate-900',
            )}
          >
            <div
              className={cn(
                'flex h-14 shrink-0 items-center justify-between border-b px-5',
                dark ? 'border-[#1E293B]' : 'border-slate-200',
              )}
            >
              <h2 className="text-[15px] font-semibold">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                className={cn(
                  'rounded p-1 transition-colors duration-120',
                  dark ? 'text-slate-400 hover:text-white' : 'text-slate-400 hover:text-slate-900',
                )}
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-5">{children}</div>
            {footer && (
              <div
                className={cn(
                  'flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3',
                  dark ? 'border-[#1E293B]' : 'border-slate-200',
                )}
              >
                {footer}
              </div>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

/** Drawer 内容分节:12px 辅助标题 + 分割线 */
export function DrawerSection({
  title,
  children,
  dark = false,
}: {
  title: string
  children: ReactNode
  dark?: boolean
}) {
  return (
    <section className="mb-5">
      <h3
        className={cn(
          'mb-2 border-b pb-2 text-xs font-medium',
          dark ? 'border-[#1E293B] text-slate-400' : 'border-slate-100 text-slate-500',
        )}
      >
        {title}
      </h3>
      {children}
    </section>
  )
}
