/**
 * 解析结果面板(sql.md §3)
 * 卡片头(状态徽标 + 耗时)→ 汇总条(5 枚统计 chip)→ Tabs(血缘明细 / 字段映射 / 警告)→ 血缘速览迷你 DAG
 */

import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { AlertTriangle, ArrowRight } from 'lucide-react'
import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { LocalParseResult, StatementType } from './parsePreview'
import { layerOf } from './parsePreview'
import { LayerBadge } from '@/components/common/LayerBadge'
import { StatusBadge } from '@/components/common/StatusBadge'
import { Tabs } from '@/components/common/Tabs'
import { MiniDag } from './MiniDag'
import type { DagPair } from './MiniDag'

export interface ParseSummary {
  targets: number
  sources: number
  tablesCreated: number
  /** null 表示不适用(预览态未入库不展示新建边计数时) */
  edgesCreated: number | null
  warnings: number
}

/** 汇总数字 400ms 计数(sql.md §3 Animation) */
function CountUp({ value, className }: { value: number; className?: string }) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / 400)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(Math.round(value * eased))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return <span className={className}>{display}</span>
}

function SummaryChip({ label, value, tone }: { label: string; value: number | '—'; tone?: 'warn' }) {
  return (
    <div className="flex items-baseline gap-2 px-5 first:pl-0">
      <span className="text-xs text-slate-500">{label}</span>
      {value === '—' ? (
        <span className="font-mono text-lg font-semibold text-slate-400">—</span>
      ) : (
        <CountUp
          value={value}
          className={cn('font-mono text-lg font-semibold', tone === 'warn' && value > 0 ? 'text-sqlwarn' : 'text-slate-900')}
        />
      )}
    </div>
  )
}

const TYPE_BADGE: Record<StatementType, string> = {
  CREATE: 'CREATE',
  CTAS: 'CTAS',
  INSERT: 'INSERT',
  SELECT: 'SELECT',
  ALTER: 'ALTER',
  UNKNOWN: '—',
}

function lineRange(lineStart: number, lineEnd: number): string {
  return lineStart === lineEnd ? `L${lineStart}` : `L${lineStart}–L${lineEnd}`
}

function warningSuggestion(text: string): string {
  if (text.includes('未指定目标表')) return '在解析配置中填写目标表名后重新解析'
  return '检查该语句语法后重试;单条语句失败不会中断整体解析'
}

export interface ParseResultPanelProps {
  loading: boolean
  mode: 'preview' | 'submit'
  failed: boolean
  local: LocalParseResult | null
  summary: ParseSummary | null
  elapsedMs: number | null
}

export function ParseResultPanel({ loading, mode, failed, local, summary, elapsedMs }: ParseResultPanelProps) {
  const [tab, setTab] = useState('lineage')

  // 解析失败时警告 Tab 自动激活(sql.md §5);渲染期派生重置,避免 effect 级联渲染
  const [prevLocal, setPrevLocal] = useState(local)
  if (local !== prevLocal) {
    setPrevLocal(local)
    if (!loading && failed) setTab('warnings')
  }

  const pairs: DagPair[] = []
  if (local) {
    for (const s of local.statements) {
      if (!s.target) continue
      for (const src of s.sources) pairs.push({ src, dst: s.target })
    }
  }
  const focusTarget = local?.targets[0]

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card">
      {/* 卡片头 */}
      <div className="flex h-12 items-center justify-between border-b border-slate-200 px-4">
        <h2 className="text-[15px] font-semibold text-slate-900">
          {mode === 'preview' ? '解析预览结果' : '解析结果'}
        </h2>
        <div className="flex items-center gap-3">
          {loading ? (
            <StatusBadge status="parsing" />
          ) : failed ? (
            <StatusBadge status="parse_failed" />
          ) : mode === 'preview' ? (
            <StatusBadge status="pending" label="预览 · 未入库" />
          ) : (
            <StatusBadge status="parsed" />
          )}
          {elapsedMs !== null && !loading && (
            <span className="font-mono text-xs text-slate-500">sqlglot · {Math.round(elapsedMs)}ms</span>
          )}
        </div>
      </div>

      {loading ? (
        /* 骨架屏(slate-100 呼吸 1.2s) */
        <div className="space-y-3 p-4">
          <div className="h-6 w-2/3 animate-pulse-soft rounded bg-slate-100" />
          <div className="h-4 w-1/3 animate-pulse-soft rounded bg-slate-100" />
          <div className="h-24 w-full animate-pulse-soft rounded bg-slate-100" />
        </div>
      ) : (
        <>
          {mode === 'preview' && (
            <div className="border-b border-pending/20 bg-pending-light px-4 py-2 text-xs text-pending">
              预览结果未入库,点击「提交解析」写入血缘
            </div>
          )}

          {/* 汇总条 */}
          {summary && (
            <div className="flex items-center divide-x divide-slate-200 border-b border-slate-100 py-3">
              <SummaryChip label="目标表" value={failed ? '—' : summary.targets} />
              <SummaryChip label="源表" value={failed ? '—' : summary.sources} />
              <SummaryChip label="新建表" value={failed ? '—' : summary.tablesCreated} />
              <SummaryChip label="新建边" value={failed || summary.edgesCreated === null ? '—' : summary.edgesCreated} />
              <SummaryChip label="警告" value={summary.warnings} tone="warn" />
            </div>
          )}

          {/* Tabs */}
          <div className="px-4">
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { key: 'lineage', label: '血缘明细' },
                { key: 'columns', label: '字段映射' },
                { key: 'warnings', label: '警告', count: summary?.warnings ?? 0, countTone: 'pending' },
              ]}
            />
          </div>

          <div className="px-4 pb-2 pt-1">
            {tab === 'lineage' && (
              <div>
                {pairs.length === 0 ? (
                  <p className="py-8 text-center text-[13px] text-slate-400">本次脚本未产生血缘边</p>
                ) : (
                  local?.statements.map((s) => {
                    const target = s.target
                    if (!target || s.sources.length === 0) return null
                    return (
                      <div key={`${s.lineStart}-${target}`}>
                        {s.sources.map((src, i) => (
                          <motion.div
                            key={src}
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            transition={{ duration: 0.2, delay: Math.min(i, 15) * 0.02 }}
                            className="flex h-10 items-center gap-2 border-b border-slate-100 text-[13px] last:border-b-0"
                          >
                            <LayerBadge layer={layerOf(src)} />
                            <span className="font-mono text-slate-900">{src}</span>
                            <ArrowRight className="size-3.5 shrink-0 text-slate-400" />
                            <LayerBadge layer={layerOf(target)} />
                            <span className="font-mono text-slate-900">{target}</span>
                            <span className="ml-1 rounded bg-slate-100 px-1 py-px font-mono text-[10px] font-medium text-slate-600">
                              {TYPE_BADGE[s.type]}
                            </span>
                            <span className="ml-auto font-mono text-xs text-slate-400">
                              {lineRange(s.lineStart, s.lineEnd)}
                            </span>
                          </motion.div>
                        ))}
                      </div>
                    )
                  })
                )}
              </div>
            )}

            {tab === 'columns' && (
              <div>
                {!local || local.columnMappings.length === 0 ? (
                  <p className="py-8 text-center text-[13px] text-slate-400">未抽取到列级映射</p>
                ) : (
                  <table className="w-full">
                    <thead>
                      <tr className="h-8 border-b border-slate-100 text-left text-xs font-medium text-slate-500">
                        <th className="w-1/4 pr-3">目标列</th>
                        <th className="w-2/5 pr-3">源列</th>
                        <th>表达式</th>
                      </tr>
                    </thead>
                    <tbody>
                      {local.columnMappings.map((m, i) => (
                        <motion.tr
                          key={m.target}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ duration: 0.2, delay: Math.min(i, 15) * 0.02 }}
                          className="h-9 border-b border-slate-100 text-[13px] last:border-b-0"
                        >
                          <td className="pr-3 font-mono text-slate-900">{m.target}</td>
                          <td className="pr-3 font-mono text-slate-700">
                            {m.sources.length > 0 ? m.sources.join(', ') : '—'}
                          </td>
                          <td className="text-xs text-slate-500">
                            {m.expression ? (
                              <span className="flex items-center gap-1.5">
                                <span className="max-w-[320px] truncate font-mono">{m.expression}</span>
                                <span className="shrink-0 rounded bg-slate-100 px-1 py-px text-[10px] font-medium text-slate-500">
                                  表达式
                                </span>
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {tab === 'warnings' && (
              <div>
                {!local || local.warnings.length === 0 ? (
                  <p className="py-8 text-center text-[13px] text-slate-400">没有警告,解析通过</p>
                ) : (
                  local.warnings.map((w, i) => (
                    <div key={i} className="flex gap-2 border-b border-slate-100 py-2.5 last:border-b-0">
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.2, delay: i === 0 ? 0.2 : 0 }}
                      >
                        <AlertTriangle className={cn('mt-0.5 size-3.5 shrink-0', failed && i === 0 ? 'text-danger' : 'text-sqlwarn')} />
                      </motion.span>
                      <div>
                        <p className={cn('text-[13px]', failed && i === 0 ? 'text-danger' : 'text-slate-900')}>{w}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{warningSuggestion(w)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          {/* 血缘速览 */}
          {pairs.length > 0 && (
            <div className="border-t border-slate-100 px-4 py-3">
              <div className="mb-2">
                <span className="text-xs font-medium text-slate-500">血缘速览</span>
              </div>
              <MiniDag pairs={pairs} />
              {focusTarget && (
                <div className="mt-1.5 flex justify-end">
                  <Link
                    to={`/lineage?table=${encodeURIComponent(focusTarget)}`}
                    className="text-xs text-primary-600 hover:underline underline-offset-4"
                  >
                    在血缘图谱中查看 →
                  </Link>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
