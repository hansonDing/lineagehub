/** 共享格式化与文案映射(design.md §11) */

import type { ApproverRole, TableLayer } from './api'
import { getLang } from './i18n'

/** 英文相对时间:过去「3 days ago」/未来「in 3 days」 */
function enRelative(n: number, unit: 'min' | 'hr' | 'day', past: boolean): string {
  const label = unit === 'day' ? (n === 1 ? 'day' : 'days') : unit
  return past ? `${n} ${label} ago` : `in ${n} ${label}`
}

/** 相对时间:<1h「12 分钟前 / 12 min ago」、<24h「3 小时前 / 3 hr ago」,否则「3 天前 / 3 days ago」/绝对日期 */
export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const time = new Date(iso).getTime()
  if (Number.isNaN(time)) return iso
  const diff = Date.now() - time
  const abs = Math.abs(diff)
  const past = diff >= 0
  if (getLang() === 'en') {
    if (abs < 60_000) return 'just now'
    if (abs < 3_600_000) return enRelative(Math.floor(abs / 60_000), 'min', past)
    if (abs < 86_400_000) return enRelative(Math.floor(abs / 3_600_000), 'hr', past)
    if (abs < 7 * 86_400_000) return enRelative(Math.floor(abs / 86_400_000), 'day', past)
    return formatDateTime(iso).slice(0, 10)
  }
  const suffix = past ? '前' : '后'
  if (abs < 60_000) return '刚刚'
  if (abs < 3_600_000) return `${Math.floor(abs / 60_000)} 分钟${suffix}`
  if (abs < 86_400_000) return `${Math.floor(abs / 3_600_000)} 小时${suffix}`
  if (abs < 7 * 86_400_000) return `${Math.floor(abs / 86_400_000)} 天${suffix}`
  return formatDateTime(iso).slice(0, 10)
}

/** 绝对时间 tooltip:2024-05-12 14:32:08 */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 千分位 */
export function formatNumber(n: number): string {
  return n.toLocaleString('en-US')
}

/** 变更事件 ID:#CHG-1042 */
export function formatChangeId(id: number): string {
  return `#CHG-${String(id).padStart(4, '0')}`
}

/** 脚本 ID:#SCR-007 */
export function formatScriptId(id: number): string {
  return `#SCR-${String(id).padStart(3, '0')}`
}

export const LAYER_NAMES: Record<TableLayer, string> = {
  ods: '贴源层',
  dim: '维度层',
  dwd: '明细层',
  dws: '汇总层',
  ads: '应用层',
  other: '未识别',
}

export const LAYER_COLORS: Record<TableLayer, string> = {
  ods: '#6E8199',
  dim: '#9C8E7E',
  dwd: '#4E8FD9',
  dws: '#3FA97C',
  ads: '#C9A23F',
  other: '#8A94A6',
}

export const ROLE_NAMES: Record<ApproverRole, string> = {
  report_owner: 'Report Owner',
  system_owner: 'System Owner',
  table_owner: 'Table Owner',
}

export const CHANGE_TYPE_NAMES = {
  ddl_change: 'DDL 变更',
  sql_change: 'SQL 变更',
} as const
