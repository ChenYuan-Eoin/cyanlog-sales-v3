// lib/ask/coding.ts
// REQ: F005 - ASK 编码生成器（pure function）
// Feature Packet: F005-contract-ASK-upgrade.md v2
//
// 编码规则：ASK-001, ASK-002, ... ASK-NNN
// 同合同下编号连续，UNIQUE(contract_id, ask_code)

/**
 * 生成 ASK 编码
 * @param index 序号（从 1 开始）
 */
export function generateAskCode(index: number): string {
  if (index < 1 || !Number.isInteger(index)) {
    throw new Error(`Invalid ask index: ${index}`)
  }
  return `ASK-${String(index).padStart(3, '0')}`
}

/**
 * 验证 ASK 编码格式
 * @example
 * isValidAskCode('ASK-001')  // true
 * isValidAskCode('ASK-12')   // false（必须 3 位）
 * isValidAskCode('BAD-001')  // false
 */
export function isValidAskCode(code: string): boolean {
  return /^ASK-\d{3,}$/.test(code)
}

/**
 * 从编码提取序号
 */
export function parseAskCode(code: string): number {
  if (!isValidAskCode(code)) {
    throw new Error(`Invalid ask code: ${code}`)
  }
  return parseInt(code.replace('ASK-', ''), 10)
}
