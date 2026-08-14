// REQ: F034
// PURPOSE: 报价版本/快照 checksum 测试（逐位一致硬门）
import { describe, expect, it } from 'vitest'
import { canonicalJson, quoteVersionChecksum, snapshotMatchesVersion } from './version-checksum'

const VERSION = {
  quote_no: 'QT-20260814-0001',
  version_no: 1,
  header: { customer_name: '安谋科技', currency: 'CNY', discount_rate: 0.1 },
  items: [
    { product_code: 'PROJECT', version_code: 'ENT_V6', deployment: 'PUBLIC_CLOUD', auth_mode: 'SUB_YEAR', quantity: 10, unit_price: 1500, list_price: 15000 },
  ],
}

describe('canonicalJson / quoteVersionChecksum', () => {
  it('key 顺序不影响 checksum（同一语义=同一指纹）', () => {
    const a = { b: 1, a: 2 }
    const b = { a: 2, b: 1 }
    expect(canonicalJson(a)).toBe(canonicalJson(b))
    expect(quoteVersionChecksum(a)).toBe(quoteVersionChecksum(b))
  })

  it('数值精度固定（1500 vs 1500.0000 同指纹）', () => {
    expect(canonicalJson(1500)).toBe(canonicalJson(1500.0000))
  })

  it('任一字段变化 → checksum 不同', () => {
    const changed = { ...VERSION, items: [{ ...VERSION.items[0], quantity: 11 }] }
    expect(quoteVersionChecksum(VERSION)).not.toBe(quoteVersionChecksum(changed))
  })

  it('快照与版本逐位一致：snapshotMatchesVersion 通过；改动后不通过', () => {
    const snapshot = quoteVersionChecksum(VERSION)
    expect(snapshotMatchesVersion(VERSION, snapshot)).toBe(true)
    const changed = { ...VERSION, header: { ...VERSION.header, discount_rate: 0.2 } }
    expect(snapshotMatchesVersion(changed, snapshot)).toBe(false)
  })
})
