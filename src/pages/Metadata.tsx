/**
 * 元数据配置(/metadata)— metadata.md
 * 三标签页:业务系统(CRUD)/ 数仓表(行内配置来源系统与负责人)/ 报表(CRUD)
 * 与 URL ?tab=systems|tables|reports 同步,支持 ?layer= ?keyword= 深链
 */

import type { ReactNode } from 'react'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { motion } from 'framer-motion'
import type {
  GraphResponse,
  ReportListItem,
  SqlScript,
  System,
  TableLayer,
  TableListItem,
} from '@/lib/api'
import {
  getLineageOverview,
  listReports,
  listScripts,
  listSystems,
  listTables,
} from '@/lib/api'
import { Tabs } from '@/components/common/Tabs'
import { toast } from '@/components/common/Toast'
import { SystemsTab } from '@/components/metadata/SystemsTab'
import type { TablesDeepLink } from '@/components/metadata/TablesTab'
import { TablesTab } from '@/components/metadata/TablesTab'
import { ReportsTab } from '@/components/metadata/ReportsTab'

/** 首屏入场仅播放一次(metadata.md §1) */
let entrancePlayed = false

const ENTRANCE = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
}

function Section({ index, className, children }: { index: number; className?: string; children: ReactNode }) {
  const shouldAnimate = !entrancePlayed
  return (
    <motion.section
      className={className}
      initial={shouldAnimate ? ENTRANCE.initial : false}
      animate={ENTRANCE.animate}
      transition={{ ...ENTRANCE.transition, delay: shouldAnimate ? index * 0.06 : 0 }}
    >
      {children}
    </motion.section>
  )
}

type TabKey = 'systems' | 'tables' | 'reports'
const VALID_TABS: TabKey[] = ['systems', 'tables', 'reports']
const VALID_LAYERS: TableLayer[] = ['ods', 'dim', 'dwd', 'dws', 'ads']

export default function Metadata() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<TabKey>('systems')
  const [systems, setSystems] = useState<System[]>([])
  const [tables, setTables] = useState<TableListItem[]>([])
  const [reports, setReports] = useState<ReportListItem[]>([])
  const [scripts, setScripts] = useState<SqlScript[]>([])
  const [overview, setOverview] = useState<GraphResponse | null>(null)
  const [loading, setLoading] = useState(true)

  // 深链(系统 Tab 跳转 / URL 参数)
  const [tablesDeep, setTablesDeep] = useState<TablesDeepLink | null>(null)
  const [tablesNonce, setTablesNonce] = useState(0)
  const [reportsDeep, setReportsDeep] = useState<{ systemId?: number } | null>(null)
  const [reportsNonce, setReportsNonce] = useState(0)

  const refresh = useCallback(async () => {
    const [sys, tbl, rep, scr, ov] = await Promise.all([
      listSystems(),
      listTables(),
      listReports(),
      listScripts(),
      getLineageOverview(),
    ])
    setSystems(sys)
    setTables(tbl)
    setReports(rep)
    setScripts(scr)
    setOverview(ov)
  }, [])

  useEffect(() => {
    entrancePlayed = false
    setLoading(true)
    refresh()
      .catch(() => toast.error('加载失败', '无法获取元数据'))
      .finally(() => setLoading(false))
  }, [refresh])

  // 初始 URL 深链(仅挂载时读取一次)
  useEffect(() => {
    const t = searchParams.get('tab') as TabKey | null
    if (t && VALID_TABS.includes(t)) setTab(t)
    const deep: TablesDeepLink = {}
    const layer = searchParams.get('layer') as TableLayer | null
    if (layer && VALID_LAYERS.includes(layer)) deep.layer = layer
    const keyword = searchParams.get('keyword')
    if (keyword) deep.keyword = keyword
    const system = searchParams.get('system')
    if (system === 'none') deep.systemId = 'none'
    else if (system && !Number.isNaN(Number(system))) deep.systemId = Number(system)
    if (Object.keys(deep).length > 0) {
      setTablesDeep(deep)
      setTablesNonce((n) => n + 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchTab = (key: string) => {
    const next = key as TabKey
    setTab(next)
    setSearchParams({ tab: next }, { replace: true })
  }

  const goTablesBySystem = (systemId: number) => {
    setTablesDeep({ systemId })
    setTablesNonce((n) => n + 1)
    switchTab('tables')
  }

  const goReportsBySystem = (systemId: number) => {
    setReportsDeep({ systemId })
    setReportsNonce((n) => n + 1)
    switchTab('reports')
  }

  return (
    <div>
      {/* 页面头 */}
      <Section index={0}>
        <div className="mb-4 flex items-baseline justify-between">
          <h1 className="text-xl font-semibold leading-7 text-slate-900">元数据配置</h1>
          <p className="text-xs text-slate-500">血缘由 SQL 自动解析,本页维护归属与责任人</p>
        </div>
      </Section>

      {/* Tabs */}
      <Section index={1}>
        <Tabs
          value={tab}
          onChange={switchTab}
          items={[
            { key: 'systems', label: '业务系统', count: systems.length },
            { key: 'tables', label: '数仓表', count: tables.length },
            { key: 'reports', label: '报表', count: reports.length },
          ]}
          className="mb-4"
        />

        {/* Tab 切换:仅透明度 150ms,无位移(metadata.md §1) */}
        <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.15 }}>
          {tab === 'systems' && (
            <SystemsTab
              systems={systems}
              tables={tables}
              reports={reports}
              loading={loading}
              onRefresh={() => void refresh()}
              onNavigateToTables={goTablesBySystem}
              onNavigateToReports={goReportsBySystem}
            />
          )}
          {tab === 'tables' && (
            <TablesTab
              tables={tables}
              systems={systems}
              scripts={scripts}
              overview={overview}
              loading={loading}
              onRefresh={() => void refresh()}
              deepLink={tablesDeep}
              deepLinkNonce={tablesNonce}
            />
          )}
          {tab === 'reports' && (
            <ReportsTab
              reports={reports}
              systems={systems}
              tables={tables}
              loading={loading}
              onRefresh={() => void refresh()}
              deepLink={reportsDeep}
              deepLinkNonce={reportsNonce}
            />
          )}
        </motion.div>
      </Section>
    </div>
  )
}
