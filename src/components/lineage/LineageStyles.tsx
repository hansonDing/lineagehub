/**
 * 血缘画布局部样式(不改动全局 index.css,以 <style> 注入)
 * - 高亮边能量流动画:stroke-dasharray 6 6,1.6s 线性循环,方向指向下游(design.md §8.4)
 * - 节点/边透明度与颜色过渡 200ms
 * - 隐藏连接 Handle
 * - prefers-reduced-motion:流动动画保留但减速(design.md §8 无障碍)
 */
export function LineageStyles() {
  return (
    <style>{`
      .lineage-canvas .react-flow__node {
        transition: opacity 200ms;
      }
      .lineage-canvas .react-flow__edge {
        transition: opacity 200ms;
      }
      .lineage-canvas .react-flow__edge-path {
        transition: stroke 200ms, stroke-width 200ms, opacity 200ms;
      }
      @keyframes lineage-dash {
        to { stroke-dashoffset: -12; }
      }
      .lineage-canvas .lineage-edge-flow .react-flow__edge-path {
        stroke-dasharray: 6 6;
        animation: lineage-dash 1.6s linear infinite;
      }
      @media (prefers-reduced-motion: reduce) {
        .lineage-canvas .lineage-edge-flow .react-flow__edge-path {
          animation-duration: 3.2s !important;
          animation-iteration-count: infinite !important;
        }
      }
      .lineage-canvas .react-flow__handle {
        opacity: 0;
        width: 4px;
        height: 4px;
        min-width: 0;
        min-height: 0;
        border: none;
        background: transparent;
        pointer-events: none;
      }
      .lineage-canvas .react-flow__minimap {
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid #1E293B;
      }
      .lineage-canvas .react-flow__attribution {
        background: transparent;
        color: #55637A;
      }
      .lineage-canvas .react-flow__attribution a {
        color: #55637A;
      }
    `}</style>
  )
}
