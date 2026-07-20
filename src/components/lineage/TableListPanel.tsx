import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { TableLayer } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { LAYER_ORDER, layerColor } from './constants'
import type { TableRef } from './constants'

/**
 * 左侧表清单面板(lineage.md §3)
 * 宽 240px 深色,按层分组可折叠;点击表 → 聚焦并居中;可折叠为 40px 层色点窄轨
 */
export function TableListPanel({
  tables,
  focusName,
  onPick,
}: {
  tables: TableRef[]
  focusName: string | null
  onPick: (t: TableRef) => void
}) {
  const { t } = useT()
  const [collapsed, setCollapsed] = useState(false)
  const [closedGroups, setClosedGroups] = useState<Set<TableLayer>>(new Set())

  const groups = useMemo(() => {
    const byLayer = new Map<TableLayer, TableRef[]>()
    for (const t of tables) {
      if (!byLayer.has(t.layer)) byLayer.set(t.layer, [])
      byLayer.get(t.layer)!.push(t)
    }
    return LAYER_ORDER.filter((l) => byLayer.has(l)).map((l) => ({
      layer: l,
      tables: byLayer.get(l)!.slice().sort((a, b) => a.name.localeCompare(b.name)),
    }))
  }, [tables])

  const toggleGroup = (layer: TableLayer) => {
    setClosedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return next
    })
  }

  return (
    <motion.aside
      initial={{ x: '-100%' }}
      animate={{ x: 0 }}
      transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
      className="absolute bottom-0 left-0 top-16 z-10"
    >
      <motion.div
        animate={{ width: collapsed ? 40 : 240 }}
        transition={{ duration: 0.2 }}
        className="flex h-full flex-col border-r border-[#1E293B] bg-[rgba(12,18,34,0.95)]"
      >
        {collapsed ? (
          /* 40px 窄轨:层色点纵列 + 展开按钮 */
          <div className="flex flex-col items-center gap-2 py-3">
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label={t('lineage.panel.expand')}
              className="rounded p-1 text-[#8B98AD] transition-colors duration-120 hover:bg-[rgba(148,163,184,0.08)] hover:text-[#CBD5E1]"
            >
              <PanelLeftOpen className="size-3.5" />
            </button>
            {groups.map((g) => (
              <button
                key={g.layer}
                type="button"
                onClick={() => setCollapsed(false)}
                title={t('lineage.panel.groupInfo', { layer: g.layer.toUpperCase(), count: g.tables.length })}
                className="size-1.5 rounded-full"
                style={{ backgroundColor: layerColor(g.layer) }}
              />
            ))}
          </div>
        ) : (
          <>
            {/* 头部 */}
            <div className="flex h-10 shrink-0 items-center justify-between border-b border-[#1E293B] px-3">
              <span className="text-xs text-[#55637A]">
                {t('lineage.panel.title')} <span className="font-mono">{tables.length}</span>
              </span>
              <button
                type="button"
                onClick={() => setCollapsed(true)}
                aria-label={t('lineage.panel.collapse')}
                className="rounded p-1 text-[#8B98AD] transition-colors duration-120 hover:bg-[rgba(148,163,184,0.08)] hover:text-[#CBD5E1]"
              >
                <PanelLeftClose className="size-3.5" />
              </button>
            </div>
            {/* 分组主体 */}
            <div className="min-h-0 flex-1 overflow-y-auto py-1">
              {groups.map((g) => {
                const closed = closedGroups.has(g.layer)
                return (
                  <div key={g.layer}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(g.layer)}
                      className="flex h-8 w-full items-center gap-2 px-3 text-left transition-colors duration-120 hover:bg-[rgba(148,163,184,0.06)]"
                    >
                      <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: layerColor(g.layer) }} />
                      <span className="font-mono text-[11px] font-medium uppercase text-[#8B98AD]">{g.layer}</span>
                      <span className="font-mono text-[11px] text-[#55637A]">{g.tables.length}</span>
                      <ChevronDown
                        className={cn(
                          'ml-auto size-3 text-[#55637A] transition-transform duration-200',
                          closed && '-rotate-90',
                        )}
                      />
                    </button>
                    <AnimatePresence initial={false}>
                      {!closed && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          {g.tables.map((t) => {
                            const active = t.name === focusName
                            return (
                              <button
                                key={t.id}
                                type="button"
                                onClick={() => onPick(t)}
                                title={t.name}
                                className={cn(
                                  'flex h-8 w-full items-center px-3 pl-6 text-left transition-colors duration-120',
                                  active
                                    ? 'bg-[rgba(45,212,191,0.10)] text-[#5EEAD4]'
                                    : 'text-[#CBD5E1] hover:bg-[rgba(148,163,184,0.08)]',
                                )}
                              >
                                <span className="truncate font-mono text-xs">{t.name}</span>
                              </button>
                            )
                          })}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </motion.div>
    </motion.aside>
  )
}
