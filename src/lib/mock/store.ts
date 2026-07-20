/**
 * 演示模式内存状态 + localStorage 持久化。
 * 首次进入用 seed 初始化(与后端 DB 为空时自动灌入的种子一致):
 * 表/字段/血缘边由 engine 对种子 SQL 真实解析生成,不手写任何边。
 * 所有写操作后调用 persist() 持久化到 localStorage(键 lineagehub-demo-v3)。
 */

import type { Report, SqlScriptDetail } from '@/lib/api'
import {
  SEED_REPORTS,
  SEED_SCRIPTS,
  SEED_SYSTEMS,
  SEED_TABLE_OWNERS,
  SEED_TABLE_SOURCE,
} from './seed'
import { detectSqlType, engineParse, nextId, nowIso, persistParse, type MockState } from './engine'

export const DEMO_STORAGE_KEY = 'lineagehub-demo-v3'

let cached: MockState | null = null

function emptyState(): MockState {
  return {
    systems: [],
    tables: [],
    columns: [],
    scripts: [],
    edges: [],
    reports: [],
    changes: [],
    approvals: [],
    seq: { system: 1, table: 1, column: 1, script: 1, edge: 1, report: 1, change: 1, approval: 1 },
  }
}

/** 由种子常量构建初始状态(解析引擎生成表结构与血缘边) */
export function buildSeedState(): MockState {
  const state = emptyState()
  const now = nowIso()

  // 1. 系统
  for (const spec of SEED_SYSTEMS) {
    state.systems.push({ id: nextId(state, 'system'), ...spec })
  }

  // 2. DDL + ETL 脚本:真实经过解析引擎注册表结构与血缘边
  for (const { name, sql_text } of SEED_SCRIPTS) {
    const result = engineParse(sql_text)
    const script: SqlScriptDetail = {
      id: nextId(state, 'script'),
      name,
      sql_type: detectSqlType(result),
      sql_text,
      target_table: null,
      version: 1,
      created_at: now,
      updated_at: now,
    }
    state.scripts.push(script)
    persistParse(state, result, script)
  }

  // 3. 表负责人与来源系统配置
  for (const table of state.tables) {
    table.owner = SEED_TABLE_OWNERS[table.name] ?? ''
    const srcName = SEED_TABLE_SOURCE[table.name]
    if (srcName) {
      const sys = state.systems.find((s) => s.name === srcName)
      if (sys) table.source_system_id = sys.id
    }
  }

  // 4. 报表
  for (const spec of SEED_REPORTS) {
    const table = state.tables.find((t) => t.name === spec.table)
    const system = state.systems.find((s) => s.name === spec.system)
    if (!table || !system) continue
    const report: Report = {
      id: nextId(state, 'report'),
      name: spec.name,
      table_id: table.id,
      target_system_id: system.id,
      owner: spec.owner,
      owner_contact: spec.owner_contact,
      schedule: spec.schedule,
      description: spec.description,
    }
    state.reports.push(report)
  }

  return state
}

function loadFromStorage(): MockState | null {
  try {
    const raw = window.localStorage.getItem(DEMO_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { v?: number; state?: MockState }
    const s = parsed?.state
    if (parsed?.v !== 1 || !s) return null
    // 基本完整性校验,损坏数据回退 seed
    if (
      !Array.isArray(s.systems) ||
      !Array.isArray(s.tables) ||
      !Array.isArray(s.columns) ||
      !Array.isArray(s.scripts) ||
      !Array.isArray(s.edges) ||
      !Array.isArray(s.reports) ||
      !Array.isArray(s.changes) ||
      !Array.isArray(s.approvals) ||
      typeof s.seq !== 'object' ||
      s.seq === null
    ) {
      return null
    }
    return s
  } catch {
    return null
  }
}

/** 获取当前状态(首次访问时从 localStorage 恢复或由 seed 初始化) */
export function getState(): MockState {
  if (cached) return cached
  cached = loadFromStorage() ?? buildSeedState()
  return cached
}

/** 所有写操作后调用:持久化到 localStorage(隐私模式等失败时静默,内存态仍可用) */
export function persist(): void {
  if (!cached) return
  try {
    window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify({ v: 1, state: cached }))
  } catch {
    /* 存储不可用(隐私模式/超配额)时仅保留内存态 */
  }
}

/** 重置演示数据为初始种子(调试用) */
export function resetDemoState(): MockState {
  cached = buildSeedState()
  persist()
  return cached
}
