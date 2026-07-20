import dagre from 'dagre'
import type { Edge, Node } from '@xyflow/react'
import { MarkerType } from '@xyflow/react'
import type { GraphEdge, GraphNode, GraphResponse, TableLayer } from '@/lib/api'
import {
  DIM_OPACITY,
  DOWNSTREAM_COLOR,
  EDGE_COLOR,
  GROUP_NODE_HEIGHT,
  NODE_HEIGHT,
  NODE_WIDTH,
  UPSTREAM_COLOR,
  layerColor,
} from './constants'

export type CanvasDirection = 'LR' | 'TB'

/** 节点视觉状态(hover 链路高亮) */
export type NodeVisual = 'normal' | 'hover' | 'upstream' | 'downstream' | 'dimmed'
export type EdgeVisual = 'normal' | 'upstream' | 'downstream' | 'dimmed'

export interface TableNodeData extends Record<string, unknown> {
  kind: 'table'
  tableId: number
  name: string
  layer: TableLayer
  owner: string
  isReportSource: boolean
  /** 聚焦模式下的焦点表 */
  focused: boolean
  selected: boolean
  visual: NodeVisual
  direction: CanvasDirection
}

export interface GroupNodeData extends Record<string, unknown> {
  kind: 'group'
  layer: TableLayer
  count: number
  direction: CanvasDirection
}

export type TableFlowNode = Node<TableNodeData, 'tableNode'>
export type GroupFlowNode = Node<GroupNodeData, 'groupNode'>
export type FlowNode = TableFlowNode | GroupFlowNode

// ---------------------------------------------------------------- dagre 布局

interface LayoutItem {
  id: string
  width: number
  height: number
}

/** dagre 自动分层布局,返回节点 id → 左上角坐标 */
export function dagreLayout(
  items: LayoutItem[],
  edges: { source: string; target: string }[],
  direction: CanvasDirection,
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: direction, nodesep: 36, ranksep: 96, marginx: 24, marginy: 24 })
  for (const item of items) g.setNode(item.id, { width: item.width, height: item.height })
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target)
  }
  dagre.layout(g)
  const positions = new Map<string, { x: number; y: number }>()
  for (const item of items) {
    const n = g.node(item.id)
    positions.set(item.id, { x: n.x - item.width / 2, y: n.y - item.height / 2 })
  }
  return positions
}

// ---------------------------------------------------------------- 链路计算

export interface ChainSets {
  up: Set<number>
  down: Set<number>
}

/** 以 hoverId 为焦点,沿边递归求全部上游 / 下游节点(不含焦点自身) */
export function computeChains(edges: GraphEdge[], hoverId: number): ChainSets {
  const fwd = new Map<number, number[]>()
  const rev = new Map<number, number[]>()
  for (const e of edges) {
    if (!fwd.has(e.source)) fwd.set(e.source, [])
    fwd.get(e.source)!.push(e.target)
    if (!rev.has(e.target)) rev.set(e.target, [])
    rev.get(e.target)!.push(e.source)
  }
  const walk = (adj: Map<number, number[]>) => {
    const seen = new Set<number>()
    const queue = [hoverId]
    while (queue.length) {
      const cur = queue.shift()!
      for (const nxt of adj.get(cur) ?? []) {
        if (!seen.has(nxt)) {
          seen.add(nxt)
          queue.push(nxt)
        }
      }
    }
    return seen
  }
  return { up: walk(rev), down: walk(fwd) }
}

// ---------------------------------------------------------------- 图构建

export interface BuildOptions {
  graph: GraphResponse
  direction: CanvasDirection
  /** 仅全量总览:隐藏层 */
  hiddenLayers: Set<TableLayer>
  /** 仅全量总览:>150 节点时按层聚合 */
  aggregate: boolean
  /** 聚合模式下已展开的层 */
  expandedLayers: Set<TableLayer>
  hoverId: number | null
  selectedId: number | null
  focusId: number | null
}

export interface BuiltGraph {
  nodes: FlowNode[]
  edges: Edge[]
  /** 过滤隐藏层后的可见表数(聚合前) */
  visibleTableCount: number
  /** 过滤隐藏层后的可见边数(聚合前) */
  visibleEdgeCount: number
  /** 是否实际发生了聚合 */
  aggregated: boolean
}

export function edgeStyleProps(visual: EdgeVisual): {
  style: Edge['style']
  className?: string
  markerEnd: Edge['markerEnd']
} {
  if (visual === 'upstream' || visual === 'downstream') {
    const color = visual === 'upstream' ? UPSTREAM_COLOR : DOWNSTREAM_COLOR
    return {
      style: { stroke: color, strokeWidth: 2 },
      className: 'lineage-edge-flow',
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
    }
  }
  if (visual === 'dimmed') {
    return {
      style: { stroke: EDGE_COLOR, strokeWidth: 1.5, opacity: DIM_OPACITY },
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: EDGE_COLOR },
    }
  }
  return {
    style: { stroke: EDGE_COLOR, strokeWidth: 1.5 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: EDGE_COLOR },
  }
}

function classifyNode(id: number, hoverId: number | null, chains: ChainSets | null): NodeVisual {
  if (hoverId == null || !chains) return 'normal'
  if (id === hoverId) return 'hover'
  if (chains.up.has(id)) return 'upstream'
  if (chains.down.has(id)) return 'downstream'
  return 'dimmed'
}

function classifyEdge(e: GraphEdge, hoverId: number | null, chains: ChainSets | null): EdgeVisual {
  if (hoverId == null || !chains) return 'normal'
  if (chains.up.has(e.source) && (chains.up.has(e.target) || e.target === hoverId)) return 'upstream'
  if (chains.down.has(e.target) && (chains.down.has(e.source) || e.source === hoverId)) return 'downstream'
  return 'dimmed'
}

/** GraphResponse → React Flow 节点/边(含隐藏层过滤、聚合兜底、hover 高亮分类、dagre 布局) */
export function buildFlowGraph(opts: BuildOptions): BuiltGraph {
  const { graph, direction, hiddenLayers, aggregate, expandedLayers, hoverId, selectedId, focusId } = opts

  // 1. 隐藏层过滤(仅总览;聚焦模式忽略)
  const filtering = hiddenLayers.size > 0
  const nodes = filtering ? graph.nodes.filter((n) => !hiddenLayers.has(n.layer)) : graph.nodes
  const ids = new Set(nodes.map((n) => n.id))
  const edges = filtering ? graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) : graph.edges

  const chains = hoverId != null && ids.has(hoverId) ? computeChains(edges, hoverId) : null

  // 2. 聚合(>150 节点全量总览):未展开层合并为分组节点
  if (aggregate) {
    const byLayer = new Map<TableLayer, GraphNode[]>()
    for (const n of nodes) {
      if (!byLayer.has(n.layer)) byLayer.set(n.layer, [])
      byLayer.get(n.layer)!.push(n)
    }
    const entityOf = (n: GraphNode) => (expandedLayers.has(n.layer) ? `t-${n.id}` : `g-${n.layer}`)
    const nodeById = new Map(nodes.map((n) => [n.id, n]))

    const items: LayoutItem[] = []
    const flowNodes: FlowNode[] = []
    const groupMeta: { layer: TableLayer; count: number }[] = []
    for (const [layer, list] of byLayer) {
      if (expandedLayers.has(layer)) {
        for (const n of list) {
          items.push({ id: `t-${n.id}`, width: NODE_WIDTH, height: NODE_HEIGHT })
        }
      } else {
        items.push({ id: `g-${layer}`, width: NODE_WIDTH, height: GROUP_NODE_HEIGHT })
        groupMeta.push({ layer, count: list.length })
      }
    }

    // 聚合边
    const aggEdges = new Map<string, { source: string; target: string }>()
    for (const e of edges) {
      const s = nodeById.get(e.source)
      const t = nodeById.get(e.target)
      if (!s || !t) continue
      const se = entityOf(s)
      const te = entityOf(t)
      if (se === te) continue
      aggEdges.set(`${se}->${te}`, { source: se, target: te })
    }
    const aggEdgeList = [...aggEdges.values()]
    const positions = dagreLayout(items, aggEdgeList, direction)

    for (const item of items) {
      const pos = positions.get(item.id) ?? { x: 0, y: 0 }
      if (item.id.startsWith('g-')) {
        const layer = item.id.slice(2) as TableLayer
        const meta = groupMeta.find((m) => m.layer === layer)!
        flowNodes.push({
          id: item.id,
          type: 'groupNode',
          position: pos,
          data: { kind: 'group', layer, count: meta.count, direction },
        })
      } else {
        const tableId = Number(item.id.slice(2))
        const n = nodeById.get(tableId)!
        const visual = classifyNode(tableId, hoverId, chains)
        flowNodes.push({
          id: item.id,
          type: 'tableNode',
          position: pos,
          style: visual === 'dimmed' ? { opacity: DIM_OPACITY } : undefined,
          data: {
            kind: 'table',
            tableId,
            name: n.name,
            layer: n.layer,
            owner: n.owner,
            isReportSource: n.is_report_source,
            focused: focusId === tableId,
            selected: selectedId === tableId,
            visual,
            direction,
          },
        })
      }
    }

    const flowEdges: Edge[] = aggEdgeList.map((e) => {
      const props = edgeStyleProps('normal')
      return {
        id: `e-${e.source}-${e.target}`,
        source: e.source,
        target: e.target,
        type: 'default',
        ...props,
      }
    })
    return { nodes: flowNodes, edges: flowEdges, visibleTableCount: nodes.length, visibleEdgeCount: edges.length, aggregated: true }
  }

  // 3. 常规(非聚合)
  const items: LayoutItem[] = nodes.map((n) => ({ id: `t-${n.id}`, width: NODE_WIDTH, height: NODE_HEIGHT }))
  const positions = dagreLayout(
    items,
    edges.map((e) => ({ source: `t-${e.source}`, target: `t-${e.target}` })),
    direction,
  )

  const flowNodes: FlowNode[] = nodes.map((n) => {
    const visual = classifyNode(n.id, hoverId, chains)
    return {
      id: `t-${n.id}`,
      type: 'tableNode',
      position: positions.get(`t-${n.id}`) ?? { x: 0, y: 0 },
      style: visual === 'dimmed' ? { opacity: DIM_OPACITY } : undefined,
      data: {
        kind: 'table',
        tableId: n.id,
        name: n.name,
        layer: n.layer,
        owner: n.owner,
        isReportSource: n.is_report_source,
        focused: n.focus === true || focusId === n.id,
        selected: selectedId === n.id,
        visual,
        direction,
      },
    }
  })

  const flowEdges: Edge[] = edges.map((e) => {
    const visual = classifyEdge(e, hoverId, chains)
    const props = edgeStyleProps(visual)
    return {
      id: `e-${e.id}`,
      source: `t-${e.source}`,
      target: `t-${e.target}`,
      type: 'default',
      ...props,
    }
  })

  return { nodes: flowNodes, edges: flowEdges, visibleTableCount: nodes.length, visibleEdgeCount: edges.length, aggregated: false }
}

// ------------------------------------------------- hover 高亮(增量更新用)

export interface HoverVisuals {
  /** tableId → 节点视觉状态(仅覆盖当前可见的实体表节点) */
  nodeVisual: Map<number, NodeVisual>
  /** flow 边 id(e-<graphEdgeId>)→ 边视觉状态;聚合模式下为空(与 buildFlowGraph 一致) */
  edgeVisual: Map<string, EdgeVisual>
}

/**
 * 由 hoverId 计算链路高亮映射,供画布就地增量更新(setNodes/setEdges map)。
 * 与 buildFlowGraph 的分类逻辑保持一致,但不重建布局与节点/边数组。
 */
export function computeHoverVisuals(opts: {
  graph: GraphResponse
  hiddenLayers: Set<TableLayer>
  aggregate: boolean
  expandedLayers: Set<TableLayer>
  hoverId: number | null
}): HoverVisuals | null {
  const { graph, hiddenLayers, aggregate, expandedLayers, hoverId } = opts
  if (hoverId == null) return null

  const filtering = hiddenLayers.size > 0
  const nodes = filtering ? graph.nodes.filter((n) => !hiddenLayers.has(n.layer)) : graph.nodes
  const ids = new Set(nodes.map((n) => n.id))
  if (!ids.has(hoverId)) return null
  const edges = filtering
    ? graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target))
    : graph.edges
  const chains = computeChains(edges, hoverId)

  const nodeVisual = new Map<number, NodeVisual>()
  if (aggregate) {
    // 聚合模式:仅展开层的实体表参与高亮;聚合边保持 normal(与 buildFlowGraph 聚合分支一致)
    for (const n of nodes) {
      if (expandedLayers.has(n.layer)) nodeVisual.set(n.id, classifyNode(n.id, hoverId, chains))
    }
    return { nodeVisual, edgeVisual: new Map() }
  }

  for (const n of nodes) nodeVisual.set(n.id, classifyNode(n.id, hoverId, chains))
  const edgeVisual = new Map<string, EdgeVisual>()
  for (const e of edges) edgeVisual.set(`e-${e.id}`, classifyEdge(e, hoverId, chains))
  return { nodeVisual, edgeVisual }
}

/** 合并上游 / 下游两次子图请求的结果(按 id 去重) */
export function mergeGraphs(a: GraphResponse, b: GraphResponse): GraphResponse {
  const nodes = new Map<number, GraphNode>()
  for (const n of [...a.nodes, ...b.nodes]) {
    const prev = nodes.get(n.id)
    nodes.set(n.id, prev ? { ...prev, ...n, focus: prev.focus || n.focus } : n)
  }
  const edges = new Map<number, GraphEdge>()
  for (const e of [...a.edges, ...b.edges]) edges.set(e.id, e)
  return { nodes: [...nodes.values()], edges: [...edges.values()] }
}

export { UPSTREAM_COLOR, DOWNSTREAM_COLOR, layerColor }
