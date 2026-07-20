/** 系统英文代号(种子系统约定代号;其余按 id 生成,用于血缘与日志标识) */

const SYSTEM_CODES: Record<string, string> = {
  订单中心: 'order-center',
  用户中心: 'user-center',
  'BI 平台': 'bi-platform',
  财务系统: 'finance-system',
}

export function systemCode(name: string, id?: number): string {
  const known = SYSTEM_CODES[name]
  if (known) return known
  return id !== undefined ? `system-${id}` : ''
}
