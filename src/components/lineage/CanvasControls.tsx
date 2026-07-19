import { useEffect, useState } from 'react'
import { MiniMap, Panel, useReactFlow } from '@xyflow/react'
import { Maximize, Minus, Plus } from 'lucide-react'
import { motion } from 'framer-motion'
import type { FlowNode } from './graph-utils'
import { layerColor } from './constants'

/**
 * 角落控件(lineage.md §4.3):右下缩放控件(竖排 Plus/Minus/Maximize)+ 其上方 Minimap
 * 入场 opacity 0→1 200ms 延迟 200ms;详情抽屉打开时右移避让
 */
export function CanvasControls({ offsetRight }: { offsetRight: number }) {
  const rf = useReactFlow()
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShown(true), 200)
    return () => clearTimeout(t)
  }, [])

  const btn =
    'flex size-8 items-center justify-center text-[#8B98AD] transition-colors duration-120 hover:bg-[rgba(148,163,184,0.08)] hover:text-[#CBD5E1]'

  return (
    <>
      {/* Minimap 160×110:节点为层色小方块,视口框 #3B4E6E,可拖拽 */}
      <MiniMap<FlowNode>
        position="bottom-right"
        pannable
        zoomable
        style={{
          width: 160,
          height: 110,
          right: offsetRight,
          bottom: 124,
          opacity: shown ? 1 : 0,
          transition: 'right 0.28s, opacity 0.2s',
        }}
        bgColor="#0F172A"
        maskColor="rgba(10,16,31,0.62)"
        maskStrokeColor="#3B4E6E"
        maskStrokeWidth={1.5}
        nodeBorderRadius={1}
        nodeStrokeWidth={0}
        nodeColor={(n) => layerColor(String(n.data?.layer ?? 'other'))}
        ariaLabel="血缘图缩略图"
      />
      {/* 缩放控件:竖排 Plus / Minus / Maximize */}
      <Panel
        position="bottom-right"
        style={{ right: offsetRight, bottom: 16, transition: 'right 0.28s' }}
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, delay: 0.2 }}
          className="flex flex-col overflow-hidden rounded-lg border border-[#263349] bg-[#121B2E] shadow-overlay"
        >
          <button type="button" aria-label="放大" className={btn} onClick={() => rf.zoomIn({ duration: 200 })}>
            <Plus className="size-3.5" />
          </button>
          <span className="h-px bg-[#263349]" />
          <button type="button" aria-label="缩小" className={btn} onClick={() => rf.zoomOut({ duration: 200 })}>
            <Minus className="size-3.5" />
          </button>
          <span className="h-px bg-[#263349]" />
          <button
            type="button"
            aria-label="适应视图"
            className={btn}
            onClick={() => rf.fitView({ duration: 420, padding: 0.2 })}
          >
            <Maximize className="size-3.5" />
          </button>
        </motion.div>
      </Panel>
    </>
  )
}
