import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Info } from 'lucide-react'
import type { TableLayer } from '@/lib/api'
import { LAYER_ORDER, DOWNSTREAM_COLOR, UPSTREAM_COLOR, layerColor, layerName } from './constants'

/**
 * 左下图例(lineage.md §4.3):层色点 + 层名,分割线后上/下游边色说明
 * 可折叠为 Info 图标按钮;默认展开;入场 opacity 0→1 200ms 延迟 200ms
 */
export function Legend({ layers }: { layers: Set<TableLayer> }) {
  const [open, setOpen] = useState(true)
  const shown = LAYER_ORDER.filter((l) => layers.has(l))

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2, delay: 0.2 }}
      className="absolute bottom-4 left-4 z-10"
    >
      <AnimatePresence initial={false} mode="wait">
        {open ? (
          <motion.div
            key="legend"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="w-[132px] rounded-lg border border-[#263349] bg-[rgba(18,27,46,0.92)] p-3 shadow-overlay"
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[11px] text-[#55637A]">图例</span>
              <button
                type="button"
                aria-label="折叠图例"
                onClick={() => setOpen(false)}
                className="rounded p-0.5 text-[#55637A] transition-colors duration-120 hover:text-[#CBD5E1]"
              >
                <Info className="size-3" />
              </button>
            </div>
            <div className="space-y-1.5">
              {shown.map((l) => (
                <div key={l} className="flex items-center gap-2">
                  <span className="size-1.5 rounded-full" style={{ backgroundColor: layerColor(l) }} />
                  <span className="text-[11px] text-[#8B98AD]">
                    <span className="mr-1 font-mono uppercase">{l}</span>
                    {layerName(l)}
                  </span>
                </div>
              ))}
            </div>
            <div className="my-2 h-px bg-[#1E293B]" />
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="w-3 border-t-2" style={{ borderColor: UPSTREAM_COLOR }} />
                <span className="text-[11px] text-[#8B98AD]">上游</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-3 border-t-2" style={{ borderColor: DOWNSTREAM_COLOR }} />
                <span className="text-[11px] text-[#8B98AD]">下游</span>
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.button
            key="info"
            type="button"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            aria-label="展开图例"
            onClick={() => setOpen(true)}
            className="flex size-8 items-center justify-center rounded-lg border border-[#263349] bg-[rgba(18,27,46,0.92)] text-[#8B98AD] shadow-overlay transition-colors duration-120 hover:text-[#CBD5E1]"
          >
            <Info className="size-3.5" />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
