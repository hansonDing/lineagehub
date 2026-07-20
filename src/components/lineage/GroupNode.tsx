import { memo } from 'react'
import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { ChevronRight } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { NODE_BORDER, NODE_FILL, layerColor } from './constants'
import type { GroupFlowNode } from './graph-utils'

/**
 * 分组节点(>150 节点聚合兜底,lineage.md §6)
 * 每层合并为一个分组节点:层色点 + 层名 + 表数;点击展开该层
 */
function GroupNodeInner({ data }: NodeProps<GroupFlowNode>) {
  const { t } = useT()
  const color = layerColor(data.layer)
  const isTB = data.direction === 'TB'
  return (
    <div
      style={{
        width: 200,
        backgroundColor: NODE_FILL,
        border: `1px dashed ${NODE_BORDER}`,
        borderRadius: 8,
        transition: 'border-color 200ms',
      }}
      className="relative cursor-pointer px-3 py-2.5 hover:!border-[#3B4E6E]"
    >
      <Handle type="target" position={isTB ? Position.Top : Position.Left} />
      <div className="flex items-center gap-2">
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="font-mono text-[13px] font-medium uppercase leading-[18px] text-[#E2E8F0]">
          {data.layer}
        </span>
        <span className="text-[11px] leading-4 text-[#8B98AD]">{t(`common.layer.${data.layer}`)}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-between pl-4">
        <span className="font-mono text-[11px] leading-4 text-[#8B98AD]">
          {t('lineage.node.tableCount', { count: data.count })}
        </span>
        <span className="flex items-center gap-0.5 text-[11px] text-[#55637A]">
          {t('lineage.node.expand')}
          <ChevronRight className="size-3" />
        </span>
      </div>
      <Handle type="source" position={isTB ? Position.Bottom : Position.Right} />
    </div>
  )
}

export const GroupNode = memo(
  GroupNodeInner,
  (prev, next) =>
    prev.data.layer === next.data.layer &&
    prev.data.count === next.data.count &&
    prev.data.direction === next.data.direction,
)
