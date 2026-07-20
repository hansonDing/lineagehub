/** 系统英文代号(种子系统约定代号;其余按 id 生成,用于血缘与日志标识) */

const SYSTEM_CODES: Record<string, string> = {
  'Order Center': 'order-center',
  'User Center': 'user-center',
  'BI Platform': 'bi-platform',
  'Finance System': 'finance-system',
}

export function systemCode(name: string, id?: number): string {
  const known = SYSTEM_CODES[name]
  if (known) return known
  return id !== undefined ? `system-${id}` : ''
}
