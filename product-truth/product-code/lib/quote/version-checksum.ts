// REQ: F044
// PURPOSE: 报价版本与中间快照一致性（canonical checksum）
// 原则：结构化报价版本 = 合同源数据；中间快照 = 阶段 1 交付物（防伪/核对），
//      快照与所选版本逐位一致（canonical 序列化 + SHA-256）
import { createHash } from 'node:crypto'

/** 规范化序列化：key 排序、固定精度，保证同一语义数据得到同一 checksum */
export function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(',')}]`
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(Math.round((value + Number.EPSILON) * 10000) / 10000) : 'null'
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

export function quoteVersionChecksum(version: unknown): string {
  return createHash('sha256').update(canonicalJson(version), 'utf8').digest('hex')
}

/** 快照与版本一致性校验：同一版本两次 checksum 一致，任一字段变化即不一致 */
export function snapshotMatchesVersion(version: unknown, snapshotChecksum: string): boolean {
  return quoteVersionChecksum(version) === snapshotChecksum
}
