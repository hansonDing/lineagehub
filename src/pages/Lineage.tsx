import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { ReactFlow, useEdgesState, useNodesState } from '@xyflow/react'
import type { Edge, Node, ReactFlowInstance } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { AnimatePresence } from 'framer-motion'
import { Info } from 'lucide-react'
import type { GraphResponse, TableLayer, TableListItem } from '@/lib/api'
import { getLineageGraph, getLineageOverview, listTables } from '@/lib/api'
import { useT } from '@/lib/i18n'
import { toast } from '@/components/common/Toast'
import {
  AGGREGATE_THRESHOLD,
  CANVAS_BG,
  HOT_TABLE_NAME,
  NODE_HEIGHT,
  NODE_WIDTH,
} from '@/components/lineage/constants'
import type { TableRef } from '@/components/lineage/constants'
import { buildFlowGraph, mergeGraphs } from '@/components/lineage/graph-utils'
import type { FlowNode } from '@/components/lineage/graph-utils'
import { TableNode } from '@/components/lineage/TableNode'
import { GroupNode } from '@/components/lineage/GroupNode'
import { LineageStyles } from '@/components/lineage/LineageStyles'
import { Toolbar, ToolbarSkeleton } from '@/components/lineage/Toolbar'
import type { LineageMode } from '@/components/lineage/Toolbar'
import { TableListPanel } from '@/components/lineage/TableListPanel'
import { Legend } from '@/components/lineage/Legend'
import { CanvasControls } from '@/components/lineage/CanvasControls'
import { NodeContextMenu } from '@/components/lineage/NodeContextMenu'
import type { ContextMenuState } from '@/components/lineage/NodeContextMenu'
import { DetailDrawer, copyText } from '@/components/lineage/DetailDrawer'
import { CanvasLoading, EmptyLineage, ErrorLineage } from '@/components/lineage/CanvasStates'

const nodeTypes = { tableNode: TableNode, groupNode: GroupNode }
const EMPTY_LAYERS = new Set<TableLayer>()

type PendingView = { type: 'fit' } | { type: 'center'; nodeId: number }

export default function Lineage() {
  const { t } = useT()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const containerRef = useRef<HTMLDivElement>(null)
  const rfRef = useRef<ReactFlowInstance<FlowNode, Edge> | null>(null)
  const pendingViewRef = useRef<PendingView | null>(null)
  const [viewSeq, bumpView] = useReducer((x: number) => x + 1, 0)

  // ---------- 数据 ----------
  const [allTables, setAllTables] = useState<TableListItem[]>([])
  const [overview, setOverview] = useState<GraphResponse | null>(null)
  const [focusGraph, setFocusGraph] = useState<GraphResponse | null>(null)

  // ---------- 视图状态 ----------
  const [mode, setMode] = useState<LineageMode>('overview')
  const [focus, setFocus] = useState<{ id: number; name: string } | null>(null)
  const [upDepth, setUpDepth] = useState(2)
  const [downDepth, setDownDepth] = useState(2)
  const [direction, setDirection] = useState<'LR' | 'TB'>('LR')
  const [hiddenLayers, setHiddenLayers] = useState<Set<TableLayer>>(new Set())
  const [expandedLayers, setExpandedLayers] = useState<Set<TableLayer>>(new Set())
  const [hoverId, setHoverId] = useState<number | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState | null>(null)

  // ---------- 加载/错误 ----------
  const [bootLoading, setBootLoading] = useState(true)
  const [bootError, setBootError] = useState<string | null>(null)
  const [bootSeq, bumpBoot] = useReducer((x: number) => x + 1, 0)
  const [focusLoading, setFocusLoading] = useState(false)
  const [focusError, setFocusError] = useState<string | null>(null)
  const [focusSeq, bumpFocusFetch] = useReducer((x: number) => x + 1, 0)
  const bootedRef = useRef(false)
  const fetchSeqRef = useRef(0)

  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const queueView = useCallback(
    (view: PendingView) => {
      pendingViewRef.current = view
      bumpView()
    },
    [bumpView],
  )

  // ---------- 模式进入 ----------
  const enterFocus = useCallback(
    (
      id: number,
      name: string,
      opts?: { select?: boolean; center?: 'node' | 'fit'; resetDepth?: boolean },
    ) => {
      setMode('focus')
      setFocus({ id, name })
      setHoverId(null)
      setCtxMenu(null)
      if (opts?.resetDepth) {
        setUpDepth(2)
        setDownDepth(2)
      }
      setSelectedId(opts?.select ? id : null)
      queueView(opts?.center === 'fit' ? { type: 'fit' } : { type: 'center', nodeId: id })
      setSearchParams({ table: name }, { replace: true })
    },
    [queueView, setSearchParams],
  )

  const enterOverview = useCallback(() => {
    setMode('overview')
    setHoverId(null)
    setSelectedId(null)
    setCtxMenu(null)
    queueView({ type: 'fit' })
    setSearchParams({ mode: 'overview' }, { replace: true })
  }, [queueView, setSearchParams])

  // ---------- 初始加载 ----------
  useEffect(() => {
    let cancelled = false
    async function init() {
      setBootLoading(true)
      setBootError(null)
      try {
        const [tables, ov] = await Promise.all([
          listTables().catch(() => [] as TableListItem[]),
          getLineageOverview(),
        ])
        if (cancelled) return
        setAllTables(tables)
        setOverview(ov)
        const tableParam = searchParams.get('table')
        const modeParam = searchParams.get('mode')
        if (tableParam) {
          const hit =
            ov.nodes.find((n) => n.name === tableParam) ?? tables.find((t) => t.name === tableParam)
          if (hit) {
            enterFocus(hit.id, hit.name, { select: true, center: 'node' })
          } else {
            toast.error(t('lineage.toast.tableNotFound'), tableParam)
            setMode('overview')
            queueView({ type: 'fit' })
          }
        } else if (modeParam === 'overview' || ov.nodes.length <= AGGREGATE_THRESHOLD) {
          setMode('overview')
          queueView({ type: 'fit' })
        } else {
          const hot = ov.nodes.find((n) => n.name === HOT_TABLE_NAME) ?? ov.nodes[0]
          enterFocus(hot.id, hot.name, { center: 'fit' })
        }
        bootedRef.current = true
      } catch (e) {
        if (!cancelled) setBootError(e instanceof Error ? e.message : t('lineage.error.networkFailed'))
      } finally {
        if (!cancelled) setBootLoading(false)
      }
    }
    init()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootSeq])

  // ---------- URL 参数响应(页内导航 ?table=<name>) ----------
  const tableRefs: TableRef[] = useMemo(() => {
    if (allTables.length > 0) {
      return allTables.map((t) => ({ id: t.id, name: t.name, layer: t.layer, owner: t.owner }))
    }
    return (overview?.nodes ?? []).map((n) => ({ id: n.id, name: n.name, layer: n.layer, owner: n.owner }))
  }, [allTables, overview])

  useEffect(() => {
    if (!bootedRef.current) return
    const tableParam = searchParams.get('table')
    if (tableParam && tableParam !== focus?.name) {
      const hit = tableRefs.find((t) => t.name === tableParam)
      if (hit) enterFocus(hit.id, hit.name, { select: true, center: 'node' })
      else toast.error(t('lineage.toast.tableNotFound'), tableParam)
    } else if (!tableParam && searchParams.get('mode') === 'overview' && mode !== 'overview') {
      enterOverview()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  // ---------- 聚焦子图拉取(上游/下游分别按层数取,合并) ----------
  useEffect(() => {
    if (mode !== 'focus' || !focus) return
    const seq = ++fetchSeqRef.current
    setFocusLoading(true)
    setFocusError(null)
    Promise.all([
      getLineageGraph({ table_id: focus.id, direction: 'upstream', depth: upDepth }),
      getLineageGraph({ table_id: focus.id, direction: 'downstream', depth: downDepth }),
    ])
      .then(([up, down]) => {
        if (fetchSeqRef.current !== seq) return
        setFocusGraph(mergeGraphs(up, down))
      })
      .catch((e) => {
        if (fetchSeqRef.current !== seq) return
        setFocusGraph(null)
        setFocusError(e instanceof Error ? e.message : t('lineage.error.networkFailed'))
      })
      .finally(() => {
        if (fetchSeqRef.current === seq) setFocusLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, focus?.id, upDepth, downDepth, focusSeq])

  // ---------- 图构建 ----------
  const aggregate = mode === 'overview' && (overview?.nodes.length ?? 0) > AGGREGATE_THRESHOLD
  const currentGraph = mode === 'overview' ? overview : focusGraph

  const built = useMemo(() => {
    if (!currentGraph) return null
    return buildFlowGraph({
      graph: currentGraph,
      direction,
      hiddenLayers: mode === 'overview' ? hiddenLayers : EMPTY_LAYERS,
      aggregate,
      expandedLayers,
      hoverId,
      selectedId,
      focusId: mode === 'focus' ? (focus?.id ?? null) : null,
    })
  }, [currentGraph, direction, mode, hiddenLayers, aggregate, expandedLayers, hoverId, selectedId, focus?.id])

  useEffect(() => {
    setNodes(built?.nodes ?? [])
    setEdges(built?.edges ?? [])
  }, [built, setNodes, setEdges])

  // ---------- 待执行的视口动作 ----------
  useEffect(() => {
    const pending = pendingViewRef.current
    if (!pending || nodes.length === 0) return
    const rf = rfRef.current
    if (!rf) return
    pendingViewRef.current = null
    const raf = requestAnimationFrame(() => {
      if (pending.type === 'fit') {
        rf.fitView({ duration: 420, padding: 0.25 })
      } else {
        const n = nodes.find((x) => x.id === `t-${pending.nodeId}`)
        if (n) {
          rf.setCenter(n.position.x + NODE_WIDTH / 2, n.position.y + NODE_HEIGHT / 2, {
            zoom: 1.1,
            duration: 420,
          })
        }
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [nodes, viewSeq])

  // ---------- 派生数据 ----------
  const layerCounts = useMemo(() => {
    const counts: Partial<Record<TableLayer, number>> = {}
    for (const n of overview?.nodes ?? []) counts[n.layer] = (counts[n.layer] ?? 0) + 1
    return counts
  }, [overview])

  const legendLayers = useMemo(() => {
    const set = new Set<TableLayer>()
    for (const n of built?.nodes ?? []) set.add(n.data.layer)
    return set
  }, [built])

  // ---------- 事件 ----------
  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      setCtxMenu(null)
      if (node.type === 'groupNode') {
        const layer = (node as FlowNode).data.layer
        setExpandedLayers((prev) => new Set(prev).add(layer))
        queueView({ type: 'fit' })
        return
      }
      const data = (node as FlowNode).data
      if (data.kind === 'table') setSelectedId(data.tableId)
    },
    [queueView],
  )

  const onNodeDoubleClick = useCallback(
    (_: unknown, node: Node) => {
      const data = (node as FlowNode).data
      if (data.kind === 'table') {
        enterFocus(data.tableId, data.name, { resetDepth: true, center: 'fit', select: true })
      }
    },
    [enterFocus],
  )

  const onNodeMouseEnter = useCallback((_: unknown, node: Node) => {
    const data = (node as FlowNode).data
    if (data.kind === 'table') setHoverId(data.tableId)
  }, [])

  const onNodeMouseLeave = useCallback(() => setHoverId(null), [])

  const onPaneClick = useCallback(() => {
    setSelectedId(null)
    setCtxMenu(null)
  }, [])

  const onNodeContextMenu = useCallback((e: MouseEvent | React.MouseEvent, node: Node) => {
    const data = (node as FlowNode).data
    if (data.kind !== 'table') return
    e.preventDefault()
    const rect = containerRef.current?.getBoundingClientRect()
    setCtxMenu({
      x: e.clientX - (rect?.left ?? 0),
      y: e.clientY - (rect?.top ?? 0),
      tableId: data.tableId,
      tableName: data.name,
    })
  }, [])

  const handlePickTable = useCallback(
    (t: TableRef) => enterFocus(t.id, t.name, { center: 'node' }),
    [enterFocus],
  )

  const handleModeChange = useCallback(
    (m: LineageMode) => {
      if (m === mode) return
      if (m === 'overview') {
        enterOverview()
      } else {
        const target =
          focus ??
          (() => {
            const hot =
              tableRefs.find((t) => t.name === HOT_TABLE_NAME) ?? tableRefs[0]
            return hot ? { id: hot.id, name: hot.name } : null
          })()
        if (target) enterFocus(target.id, target.name, { center: 'fit' })
      }
    },
    [mode, focus, tableRefs, enterOverview, enterFocus],
  )

  const handleToggleLayer = useCallback((layer: TableLayer) => {
    setHiddenLayers((prev) => {
      const next = new Set(prev)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return next
    })
  }, [])

  const handleDepthChange = useCallback((which: 'up' | 'down', value: number) => {
    const v = Math.min(5, Math.max(1, value))
    if (which === 'up') setUpDepth(v)
    else setDownDepth(v)
  }, [])

  const handleToggleDirection = useCallback(() => {
    setDirection((d) => (d === 'LR' ? 'TB' : 'LR'))
    queueView({ type: 'fit' })
  }, [queueView])

  const handleDrawerFocus = useCallback(
    (id: number, name: string) => enterFocus(id, name, { select: true, center: 'node' }),
    [enterFocus],
  )

  // ---------- 渲染状态判定 ----------
  const showLoading =
    bootLoading || (mode === 'focus' && focusLoading && !focusGraph && !focusError)
  const showBootError = !bootLoading && bootError != null
  const showFocusError = !bootLoading && mode === 'focus' && focusError != null && !focusGraph
  const showEmpty =
    !bootLoading && !bootError && mode === 'overview' && (overview?.nodes.length ?? 0) === 0
  const isolatedFocus =
    mode === 'focus' &&
    !focusLoading &&
    focusGraph != null &&
    focusGraph.nodes.length <= 1 &&
    focusGraph.edges.length === 0
  const drawerOpen = selectedId != null
  const offsetRight = drawerOpen ? 416 : 16

  return (
    <div
      ref={containerRef}
      className="lineage-canvas relative h-full w-full overflow-hidden"
      style={{
        backgroundColor: CANVAS_BG,
        backgroundImage: 'radial-gradient(rgba(148,163,184,0.07) 1px, transparent 1px)',
        backgroundSize: '24px 24px',
      }}
    >
      <LineageStyles />

      {/* 画布层 */}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        onInit={(instance) => {
          rfRef.current = instance as ReactFlowInstance<FlowNode, Edge>
        }}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeMouseEnter={onNodeMouseEnter}
        onNodeMouseLeave={onNodeMouseLeave}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={onPaneClick}
        minZoom={0.25}
        maxZoom={2}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.25 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        onlyRenderVisibleElements
        colorMode="dark"
        panOnDrag
      >
        <CanvasControls offsetRight={offsetRight} />
      </ReactFlow>

      {/* 顶部工具条 */}
      {bootLoading ? (
        <ToolbarSkeleton />
      ) : (
        <Toolbar
          mode={mode}
          onModeChange={handleModeChange}
          tables={tableRefs}
          onPickTable={handlePickTable}
          layerCounts={layerCounts}
          hiddenLayers={hiddenLayers}
          onToggleLayer={handleToggleLayer}
          visibleTables={built?.visibleTableCount ?? 0}
          visibleEdges={built?.visibleEdgeCount ?? 0}
          upDepth={upDepth}
          downDepth={downDepth}
          onDepthChange={handleDepthChange}
          direction={direction}
          onToggleDirection={handleToggleDirection}
        />
      )}

      {/* 左侧表清单 */}
      {!bootLoading && tableRefs.length > 0 && (
        <TableListPanel tables={tableRefs} focusName={focus?.name ?? null} onPick={handlePickTable} />
      )}

      {/* 图例 */}
      {!bootLoading && legendLayers.size > 0 && <Legend layers={legendLayers} />}

      {/* 聚合提示条 */}
      {aggregate && (
        <div className="absolute left-1/2 top-4 z-10 flex h-8 -translate-x-1/2 items-center gap-2 rounded-lg border border-[rgba(29,78,216,0.3)] bg-[rgba(37,99,235,0.15)] px-3 text-xs text-[#CBD5E1]">
          <Info className="size-3.5 shrink-0 text-[#8B98AD]" />
          {t('lineage.aggregate.hint', { count: overview?.nodes.length ?? 0 })}
        </div>
      )}

      {/* 孤表提示 */}
      {isolatedFocus && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 translate-y-10 text-center">
          <p className="text-xs text-[#8B98AD]">{t('lineage.isolated.hint')}</p>
          <button
            type="button"
            onClick={() => navigate('/sql')}
            className="pointer-events-auto mt-1 text-xs text-[#2DD4BF] hover:underline"
          >
            {t('lineage.isolated.action')}
          </button>
        </div>
      )}

      {/* 加载 / 空态 / 错误 */}
      {showLoading && <CanvasLoading />}
      {showEmpty && <EmptyLineage />}
      {showBootError && <ErrorLineage message={bootError ?? ''} onRetry={bumpBoot} />}
      {showFocusError && (
        <ErrorLineage message={focusError ?? ''} onRetry={bumpFocusFetch} onBack={enterOverview} />
      )}

      {/* 右键菜单 */}
      {ctxMenu && (
        <NodeContextMenu
          menu={ctxMenu}
          onClose={() => setCtxMenu(null)}
          onViewDetail={(id) => setSelectedId(id)}
          onConfigure={() => navigate('/metadata?tab=tables')}
          onDdlChange={(id) => navigate(`/changes?tab=create&table=${id}`)}
          onCopyName={async (name) => {
            const ok = await copyText(name)
            if (ok) toast.success(t('lineage.toast.copied'), name)
            else toast.error(t('lineage.toast.copyFailed'))
          }}
        />
      )}

      {/* 右侧详情抽屉 */}
      <AnimatePresence>
        {drawerOpen && (
          <DetailDrawer
            key={selectedId}
            tableId={selectedId}
            onClose={() => setSelectedId(null)}
            onFocusTable={handleDrawerFocus}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
