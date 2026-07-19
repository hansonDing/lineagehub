import { motion } from 'framer-motion'
import { useNavigate } from 'react-router'

/**
 * 画布加载态(lineage.md §6):Network 40px #2DD4BF 描边绘入 800ms + 「正在构建血缘图…」
 */
export function CanvasLoading() {
  const draw = {
    hidden: { pathLength: 0, opacity: 0 },
    show: (i: number) => ({
      pathLength: 1,
      opacity: 1,
      transition: { duration: 0.8, delay: i * 0.08, ease: 'easeOut' as const },
    }),
  }
  const fade = {
    hidden: { opacity: 0 },
    show: (i: number) => ({ opacity: 1, transition: { duration: 0.4, delay: i * 0.08 } }),
  }
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4">
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="#2DD4BF" strokeWidth="2">
        <motion.circle cx="8" cy="8" r="4" variants={fade} custom={0} initial="hidden" animate="show" />
        <motion.circle cx="8" cy="32" r="4" variants={fade} custom={1} initial="hidden" animate="show" />
        <motion.circle cx="32" cy="20" r="4" variants={fade} custom={2} initial="hidden" animate="show" />
        <motion.line x1="12" y1="10" x2="28" y2="18" variants={draw} custom={2} initial="hidden" animate="show" />
        <motion.line x1="12" y1="30" x2="28" y2="22" variants={draw} custom={3} initial="hidden" animate="show" />
      </svg>
      <p className="text-[13px] text-[#8B98AD]">正在构建血缘图…</p>
    </div>
  )
}

/**
 * 无数据空态(lineage.md §6):empty-lineage.svg + 主操作「去提交 SQL」
 */
export function EmptyLineage() {
  const navigate = useNavigate()
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 px-6 text-center">
      <img src="/empty-lineage.svg" alt="" width={240} height={160} className="mb-3 opacity-70" />
      <p className="text-sm font-semibold text-[#CBD5E1]">还没有血缘数据</p>
      <p className="max-w-[320px] text-[13px] text-[#8B98AD]">
        提交第一个 SQL 脚本,解析引擎将自动构建血缘
      </p>
      <button
        type="button"
        onClick={() => navigate('/sql')}
        className="mt-4 h-8 rounded-md bg-primary-700 px-3 text-[13px] font-medium text-white transition-colors duration-120 hover:bg-primary-800"
      >
        去提交 SQL
      </button>
    </div>
  )
}

/**
 * 加载失败态:提示 + 重试
 */
export function ErrorLineage({
  message,
  onRetry,
  onBack,
}: {
  message: string
  onRetry: () => void
  onBack?: () => void
}) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-1 px-6 text-center">
      <img src="/empty-lineage.svg" alt="" width={240} height={160} className="mb-3 opacity-40" />
      <p className="text-sm font-semibold text-[#CBD5E1]">血缘数据加载失败</p>
      <p className="max-w-[360px] text-[13px] text-[#8B98AD]">{message}</p>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="h-8 rounded-md bg-primary-700 px-3 text-[13px] font-medium text-white transition-colors duration-120 hover:bg-primary-800"
        >
          重试
        </button>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="h-8 rounded-md border border-[#263349] px-3 text-[13px] font-medium text-[#CBD5E1] transition-colors duration-120 hover:bg-[rgba(148,163,184,0.08)]"
          >
            返回全量总览
          </button>
        )}
      </div>
    </div>
  )
}
