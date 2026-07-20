import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import { Copy, FileDiff, Info, Settings2 } from 'lucide-react'
import { useT } from '@/lib/i18n'

export interface ContextMenuState {
  x: number
  y: number
  tableId: number
  tableName: string
}

/**
 * 节点右键上下文菜单(lineage.md §4.2,深色浮层)
 * 「查看表详情」「在元数据中配置」「发起 DDL 变更」「复制表名」
 */
export function NodeContextMenu({
  menu,
  onClose,
  onViewDetail,
  onConfigure,
  onDdlChange,
  onCopyName,
}: {
  menu: ContextMenuState
  onClose: () => void
  onViewDetail: (tableId: number) => void
  onConfigure: (tableId: number) => void
  onDdlChange: (tableId: number) => void
  onCopyName: (tableName: string) => void
}) {
  const { t } = useT()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const items = [
    { label: t('lineage.action.viewDetail'), icon: Info, action: () => onViewDetail(menu.tableId) },
    { label: t('lineage.action.configure'), icon: Settings2, action: () => onConfigure(menu.tableId) },
    { label: t('lineage.action.ddlChange'), icon: FileDiff, action: () => onDdlChange(menu.tableId) },
    { label: t('lineage.action.copyName'), icon: Copy, action: () => onCopyName(menu.tableName) },
  ]

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.12 }}
      style={{ left: menu.x, top: menu.y }}
      className="absolute z-30 w-44 overflow-hidden rounded-lg border border-[#263349] bg-[#121B2E] py-1 shadow-overlay"
    >
      <div className="truncate border-b border-[#1E293B] px-3 pb-1.5 pt-2 font-mono text-[11px] text-[#55637A]">
        {menu.tableName}
      </div>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          onClick={() => {
            item.action()
            onClose()
          }}
          className="flex h-8 w-full items-center gap-2 px-3 text-left text-xs text-[#CBD5E1] transition-colors duration-120 hover:bg-[rgba(148,163,184,0.08)]"
        >
          <item.icon className="size-3.5 text-[#8B98AD]" />
          {item.label}
        </button>
      ))}
    </motion.div>
  )
}
