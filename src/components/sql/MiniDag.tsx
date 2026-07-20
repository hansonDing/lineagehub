/**
 * 血缘速览迷你 DAG(sql.md §3)
 * 仅本次脚本的源表→目标表(≤10 节点,高 160px,浅色底 #F8FAFC 圆角 6px 内嵌);
 * React Flow 只读、节点白底层色点、禁止缩放;节点 stagger 50ms scale 0.9→1 + opacity(200ms)
 */

import { useMemo } from 'react'
import { Handle, MarkerType, Position, ReactFlow } from '@xyflow/react'
import type { Edge, Node, NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { motion } from 'framer-motion'
import type { TableLayer } from '@/lib/api'
import { LAYER_COLORS } from '@/lib/format'
import { layerOf } from './parsePreview'

export interface DagPair {
  src: string
  dst: string
}

type MiniFlowNode = Node<{ name: string; layer: TableLayer; order: number }, 'mini'>

function MiniNode({ data }: NodeProps<MiniFlowNode>) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.2, delay: data.order * 0.05 }}
      className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 py-1.5 shadow-card"
    >
      <Handle type="target" position={Position.Left} className="!size-0 !border-0 !bg-transparent" />
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: LAYER_COLORS[data.layer] }}
      />
      <span className="max-w-[168px] truncate font-mono text-[12px] text-slate-900">{data.name}</span>
      <Handle type="source" position={Position.Right} className="!size-0 !border-0 !bg-transparent" />
    </motion.div>
  )
}

const nodeTypes = { mini: MiniNode }

const MAX_NODES = 10

export function MiniDag({ pairs }: { pairs: DagPair[] }) {
  const { nodes, edges } = useMemo(() => {
    // 去重,保持首次出现顺序
    const names: string[] = []
    const seenPair = new Set<string>()
    const uniqPairs: DagPair[] = []
    for (const p of pairs) {
      const key = `${p.src}→${p.dst}`
      if (seenPair.has(key)) continue
      seenPair.add(key)
      uniqPairs.push(p)
      if (!names.includes(p.src)) names.push(p.src)
      if (!names.includes(p.dst)) names.push(p.dst)
    }
    const limited = names.slice(0, MAX_NODES)

    // 分层:无入边为第 0 列,其余为前驱最大列 +1(Kahn 拓扑)
    const preds = new Map<string, string[]>()
    for (const n of limited) preds.set(n, [])
    for (const p of uniqPairs) {
      if (limited.includes(p.src) && limited.includes(p.dst)) {
        preds.get(p.dst)?.push(p.src)
      }
    }
    const col = new Map<string, number>()
    const pending = new Set(limited)
    let guard = 0
    while (pending.size > 0 && guard < 20) {
      guard++
      for (const n of Array.from(pending)) {
        const ps = (preds.get(n) ?? []).filter((p) => p !== n)
        if (ps.every((p) => col.has(p))) {
          col.set(n, ps.length === 0 ? 0 : Math.max(...ps.map((p) => col.get(p) ?? 0)) + 1)
          pending.delete(n)
        }
      }
    }
    for (const n of pending) col.set(n, 0) // 成环兜底

    // 每列内按序排行
    const rowCounter = new Map<number, number>()
    const flowNodes: MiniFlowNode[] = limited.map((name, i) => {
      const c = col.get(name) ?? 0
      const r = rowCounter.get(c) ?? 0
      rowCounter.set(c, r + 1)
      return {
        id: name,
        type: 'mini' as const,
        position: { x: c * 250, y: r * 56 },
        data: { name, layer: layerOf(name), order: i },
      }
    })

    const flowEdges: Edge[] = uniqPairs
      .filter((p) => limited.includes(p.src) && limited.includes(p.dst) && p.src !== p.dst)
      .map((p) => ({
        id: `${p.src}->${p.dst}`,
        source: p.src,
        target: p.dst,
        style: { stroke: '#CBD5E1', strokeWidth: 1.5 },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#CBD5E1', width: 14, height: 14 },
      }))

    return { nodes: flowNodes, edges: flowEdges }
  }, [pairs])

  if (nodes.length === 0) return null

  return (
    <div className="h-40 overflow-hidden rounded-md bg-slate-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        zoomOnScroll={false}
        zoomOnPinch={false}
        zoomOnDoubleClick={false}
        panOnDrag={false}
        panOnScroll={false}
        preventScrolling={false}
        attributionPosition="bottom-left"
      />
    </div>
  )
}
