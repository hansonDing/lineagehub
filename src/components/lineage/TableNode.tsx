import { memo } from 'react'
import type { CSSProperties } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { BarChart3 } from 'lucide-react'
import { useT } from '@/lib/i18n'
import {
  DOWNSTREAM_COLOR,
  NODE_BORDER,
  NODE_BORDER_HOVER,
  NODE_FILL,
  NODE_SELECTED,
  UPSTREAM_COLOR,
  layerColor,
} from './constants'
import type { TableFlowNode } from './graph-utils'

/**
 * 表节点(design.md §10 + lineage.md §4.1)
 * 宽 200px 圆角 8px;层色点 + 等宽表名(截断,hover 全文 tooltip);
 * 负责人 + 「报表源」金标;层色细条仅聚焦/选中节点;
 * hover 上游 #5EA8E8 / 下游 #E8B45F 光晕;选中 #2DD4BF + 外发光
 */
function TableNodeInner({ data }: NodeProps<TableFlowNode>) {
  const { t } = useT()
  const color = layerColor(data.layer)
  const isTB = data.direction === 'TB'

  const cardStyle: CSSProperties = {
    width: 200,
    backgroundColor: NODE_FILL,
    border: `1px solid ${NODE_BORDER}`,
    borderRadius: 8,
    transition: 'border-color 200ms, box-shadow 200ms',
  }

  if (data.visual === 'hover') {
    cardStyle.border = `1px solid ${NODE_BORDER_HOVER}`
  } else if (data.visual === 'upstream') {
    cardStyle.border = `1px solid ${UPSTREAM_COLOR}`
    cardStyle.boxShadow = `0 0 14px ${UPSTREAM_COLOR}59` // 35%
  } else if (data.visual === 'downstream') {
    cardStyle.border = `1px solid ${DOWNSTREAM_COLOR}`
    cardStyle.boxShadow = `0 0 14px ${DOWNSTREAM_COLOR}59`
  }

  if (data.selected) {
    cardStyle.border = `1.5px solid ${NODE_SELECTED}`
    cardStyle.boxShadow = '0 0 0 4px rgba(45,212,191,0.12)'
  }

  return (
    <div style={cardStyle} className="relative px-3 py-2.5">
      {/* 顶部 3px 层色细条:仅聚焦/选中节点 */}
      {(data.focused || data.selected) && (
        <span
          className="pointer-events-none absolute inset-x-0 top-0 h-[3px] rounded-t-lg"
          style={{ backgroundColor: color }}
        />
      )}
      <Handle type="target" position={isTB ? Position.Top : Position.Left} />
      {/* 第一行:层色点 + 表名 */}
      <div className="flex items-center gap-2">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span
          title={data.name}
          className="truncate font-mono text-[13px] leading-[18px] text-[#E2E8F0]"
        >
          {data.name}
        </span>
      </div>
      {/* 第二行:负责人 + 报表源标记 */}
      <div className="mt-1 flex items-center justify-between gap-2 pl-4">
        <span className="truncate text-[11px] leading-4 text-[#8B98AD]">
          {data.owner || t('lineage.node.ownerFallback')}
        </span>
        {data.isReportSource && (
          <BarChart3 className="size-3 shrink-0" style={{ color: '#C9A23F' }} aria-label={t('lineage.node.reportSource')} />
        )}
      </div>
      <Handle type="source" position={isTB ? Position.Bottom : Position.Right} />
    </div>
  )
}

export const TableNode = memo(
  TableNodeInner,
  (prev, next) =>
    prev.data.name === next.data.name &&
    prev.data.layer === next.data.layer &&
    prev.data.owner === next.data.owner &&
    prev.data.isReportSource === next.data.isReportSource &&
    prev.data.focused === next.data.focused &&
    prev.data.selected === next.data.selected &&
    prev.data.visual === next.data.visual &&
    prev.data.direction === next.data.direction,
)
