import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowDown, ArrowRight, Minus, Plus, Search } from 'lucide-react'
import type { TableLayer } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { LayerBadge } from '@/components/common/LayerBadge'
import { LAYER_ORDER, layerColor } from './constants'
import type { TableRef } from './constants'
import type { CanvasDirection } from './graph-utils'

export type LineageMode = 'overview' | 'focus'

const CHIP_LAYERS: TableLayer[] = ['ods', 'dim', 'dwd', 'dws', 'ads']

/** 深色浮层控件外壳(lineage.md §2) */
function FloatingBox({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex h-10 items-center rounded-lg border border-[#263349] bg-[rgba(18,27,46,0.92)] shadow-overlay',
        className,
      )}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------- 表搜索

function TableSearch({ tables, onPick }: { tables: TableRef[]; onPick: (t: TableRef) => void }) {
  const { t } = useT()
  const [keyword, setKeyword] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return []
    return tables.filter((t) => t.name.toLowerCase().includes(kw)).slice(0, 8)
  }, [keyword, tables])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const pick = (t: TableRef) => {
    onPick(t)
    setKeyword('')
    setOpen(false)
  }

  return (
    <div ref={boxRef} className="relative">
      <FloatingBox className="w-[180px] gap-2 px-3 sm:w-[260px]">
        <Search className="size-3.5 shrink-0 text-[#8B98AD]" />
        <input
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && matches.length > 0) pick(matches[0])
            if (e.key === 'Escape') setOpen(false)
          }}
          placeholder={t('lineage.toolbar.searchPlaceholder')}
          className="h-full min-w-0 flex-1 bg-transparent text-[13px] text-[#CBD5E1] outline-none placeholder:text-[#55637A]"
        />
        <kbd className="shrink-0 rounded border border-[#263349] bg-[#0F172A] px-1 font-mono text-[11px] leading-4 text-[#55637A]">
          ⌘K
        </kbd>
      </FloatingBox>
      <AnimatePresence>
        {open && keyword.trim() && (
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute left-0 top-11 z-30 w-full overflow-hidden rounded-lg border border-[#263349] bg-[#121B2E] py-1 shadow-overlay"
          >
            {matches.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-[#55637A]">{t('lineage.toolbar.searchEmpty')}</div>
            ) : (
              matches.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(t)}
                  className="flex h-9 w-full items-center gap-2 px-3 text-left transition-colors duration-120 hover:bg-[rgba(148,163,184,0.08)]"
                >
                  <LayerBadge layer={t.layer} dark />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-[#CBD5E1]">{t.name}</span>
                  <span className="shrink-0 text-[11px] text-[#55637A]">{t.owner}</span>
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------- 模式切换

function ModeSwitch({ mode, onChange }: { mode: LineageMode; onChange: (m: LineageMode) => void }) {
  const { t } = useT()
  const items: { key: LineageMode; label: string }[] = [
    { key: 'overview', label: t('lineage.toolbar.mode.overview') },
    { key: 'focus', label: t('lineage.toolbar.mode.focus') },
  ]
  return (
    <FloatingBox className="gap-0.5 p-1">
      {items.map((item) => {
        const active = mode === item.key
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            className={cn(
              'relative h-8 rounded-md px-3 text-[13px] transition-colors duration-180',
              active ? 'text-[#5EEAD4]' : 'text-[#8B98AD] hover:text-[#CBD5E1]',
            )}
          >
            {active && (
              <motion.span
                layoutId="lineage-mode-pill"
                transition={{ duration: 0.18 }}
                className="absolute inset-0 rounded-md bg-[rgba(45,212,191,0.12)]"
              />
            )}
            <span className="relative">{item.label}</span>
          </button>
        )
      })}
    </FloatingBox>
  )
}

// ---------------------------------------------------------------- 层筛选 chips(全量总览)

function LayerChips({
  counts,
  hiddenLayers,
  onToggle,
  visibleTables,
  visibleEdges,
}: {
  counts: Partial<Record<TableLayer, number>>
  hiddenLayers: Set<TableLayer>
  onToggle: (l: TableLayer) => void
  visibleTables: number
  visibleEdges: number
}) {
  const { t } = useT()
  const layers = CHIP_LAYERS.filter((l) => (counts[l] ?? 0) > 0)
  return (
    <FloatingBox className="gap-1 px-2">
      {layers.map((layer) => {
        const active = !hiddenLayers.has(layer)
        return (
          <button
            key={layer}
            type="button"
            onClick={() => onToggle(layer)}
            style={{ opacity: active ? 1 : 0.3 }}
            className="flex h-7 items-center gap-1.5 rounded-md px-2 transition-opacity duration-180 hover:bg-[rgba(148,163,184,0.08)]"
            title={t(active ? 'lineage.toolbar.layer.hide' : 'lineage.toolbar.layer.show', {
              layer: layer.toUpperCase(),
            })}
          >
            <span className="size-1.5 rounded-full" style={{ backgroundColor: layerColor(layer) }} />
            <span className="font-mono text-[11px] font-medium uppercase text-[#CBD5E1]">{layer}</span>
          </button>
        )
      })}
      <span className="ml-1 whitespace-nowrap text-[11px] text-[#55637A]">
        {t('lineage.toolbar.stats', { tables: visibleTables, edges: visibleEdges })}
      </span>
    </FloatingBox>
  )
}

// ---------------------------------------------------------------- 追溯层数步进器(单表聚焦)

function DepthStepper({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  const { t } = useT()
  const btn =
    'flex size-5 items-center justify-center rounded text-[#8B98AD] transition-colors duration-120 hover:bg-[rgba(148,163,184,0.12)] hover:text-[#CBD5E1] disabled:pointer-events-none disabled:opacity-40'
  return (
    <span className="flex items-center gap-1">
      <span className="text-xs text-[#8B98AD]">{label}</span>
      <button type="button" aria-label={t('lineage.toolbar.depth.decrease', { label })} className={btn} disabled={value <= 1} onClick={() => onChange(value - 1)}>
        <Minus className="size-3" />
      </button>
      <span className="w-4 text-center font-mono text-[13px] text-[#CBD5E1]">{value}</span>
      <button type="button" aria-label={t('lineage.toolbar.depth.increase', { label })} className={btn} disabled={value >= 5} onClick={() => onChange(value + 1)}>
        <Plus className="size-3" />
      </button>
      <span className="text-xs text-[#8B98AD]">{t('lineage.toolbar.depth.unit')}</span>
    </span>
  )
}

// ---------------------------------------------------------------- 工具条

export interface ToolbarProps {
  mode: LineageMode
  onModeChange: (m: LineageMode) => void
  tables: TableRef[]
  onPickTable: (t: TableRef) => void
  layerCounts: Partial<Record<TableLayer, number>>
  hiddenLayers: Set<TableLayer>
  onToggleLayer: (l: TableLayer) => void
  visibleTables: number
  visibleEdges: number
  upDepth: number
  downDepth: number
  onDepthChange: (which: 'up' | 'down', value: number) => void
  direction: CanvasDirection
  onToggleDirection: () => void
}

export function Toolbar(props: ToolbarProps) {
  const { t } = useT()
  const { mode, onModeChange, tables, onPickTable, direction, onToggleDirection } = props
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay: 0.1 }}
      className="absolute left-4 right-4 top-4 z-10 flex flex-wrap items-center gap-2"
    >
      <TableSearch tables={tables} onPick={onPickTable} />
      <ModeSwitch mode={mode} onChange={onModeChange} />
      {mode === 'overview' ? (
        <LayerChips
          counts={props.layerCounts}
          hiddenLayers={props.hiddenLayers}
          onToggle={props.onToggleLayer}
          visibleTables={props.visibleTables}
          visibleEdges={props.visibleEdges}
        />
      ) : (
        <FloatingBox className="gap-3 px-3">
          <DepthStepper label={t('lineage.toolbar.depth.upstream')} value={props.upDepth} onChange={(v) => props.onDepthChange('up', v)} />
          <span className="h-4 w-px bg-[#263349]" />
          <DepthStepper label={t('lineage.toolbar.depth.downstream')} value={props.downDepth} onChange={(v) => props.onDepthChange('down', v)} />
        </FloatingBox>
      )}
      <FloatingBox className="w-10 justify-center">
        <button
          type="button"
          onClick={onToggleDirection}
          title={t(direction === 'LR' ? 'lineage.toolbar.direction.toTB' : 'lineage.toolbar.direction.toLR')}
          className="flex size-8 items-center justify-center rounded-md text-[#8B98AD] transition-colors duration-120 hover:bg-[rgba(148,163,184,0.08)] hover:text-[#CBD5E1]"
        >
          {direction === 'LR' ? <ArrowRight className="size-3.5" /> : <ArrowDown className="size-3.5" />}
        </button>
      </FloatingBox>
    </motion.div>
  )
}

/** 加载期工具条骨架(lineage.md §6) */
export function ToolbarSkeleton() {
  return (
    <div className="absolute left-4 right-4 top-4 z-10 flex flex-wrap items-center gap-2">
      {[260, 172, 220, 40].map((w, i) => (
        <div
          key={i}
          style={{ width: w }}
          className="h-10 animate-pulse-soft rounded-lg border border-[#263349] bg-[rgba(18,27,46,0.92)]"
        />
      ))}
    </div>
  )
}

export { LAYER_ORDER }
