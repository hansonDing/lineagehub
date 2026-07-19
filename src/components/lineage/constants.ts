import type { TableLayer } from '@/lib/api'
import { LAYER_COLORS, LAYER_NAMES } from '@/lib/format'

/** 画布与节点规格(design.md §4.5 / §10) */
export const CANVAS_BG = '#0A101F'
export const NODE_FILL = '#121B2E'
export const NODE_BORDER = '#263349'
export const NODE_BORDER_HOVER = '#3B4E6E'
export const NODE_SELECTED = '#2DD4BF'
export const EDGE_COLOR = '#2E3D55'
export const UPSTREAM_COLOR = '#5EA8E8'
export const DOWNSTREAM_COLOR = '#E8B45F'
export const DIM_OPACITY = 0.22

export const NODE_WIDTH = 200
export const NODE_HEIGHT = 56
export const GROUP_NODE_HEIGHT = 64

/** 超过该节点数时全量总览按层聚合兜底(lineage.md §6) */
export const AGGREGATE_THRESHOLD = 150

/** 默认聚焦的热点表(lineage.md §1) */
export const HOT_TABLE_NAME = 'dwd.dwd_trade_order_detail'

/** 层展示顺序:ods → dim → dwd → dws → ads → other */
export const LAYER_ORDER: TableLayer[] = ['ods', 'dim', 'dwd', 'dws', 'ads', 'other']

export { LAYER_COLORS, LAYER_NAMES }

export function layerColor(layer: string): string {
  return LAYER_COLORS[(layer as TableLayer) in LAYER_COLORS ? (layer as TableLayer) : 'other']
}

export function layerName(layer: string): string {
  return LAYER_NAMES[(layer as TableLayer) in LAYER_NAMES ? (layer as TableLayer) : 'other']
}

/** 搜索 / 左侧面板使用的轻量表引用 */
export interface TableRef {
  id: number
  name: string
  layer: TableLayer
  owner: string
}
