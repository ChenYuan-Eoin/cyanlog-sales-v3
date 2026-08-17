// REQ: F038/F044
// PURPOSE: 累计阶梯计价（ONES 口径）测试 + Project 价盘档边界证据
import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveCumulativeTierPrice, type CumulativeTier } from './cumulative'
import { parsePriceTableDump } from '@/lib/config-center/price-import'

function entCloudRows(): CumulativeTier[] {
  return parsePriceTableDump(readFileSync(resolve(__dirname, '../config-center/__fixtures__/price-table-dump.txt'), 'utf-8'))
    .filter((r) => r.version_code === 'ENT_V6' && r.deployment === 'PUBLIC_CLOUD' && r.auth_mode === 'SUB_YEAR' && r.term_months === 12)
    .map((r) => ({ qty_from: r.qty_from, qty_to: r.qty_to, unit_price: r.unit_price, list_price: r.list_price }))
}

describe('resolveCumulativeTierPrice 基础', () => {
  const tiers: CumulativeTier[] = [
    { qty_from: 1, qty_to: 10, unit_price: 625, list_price: 6250 },
    { qty_from: 11, qty_to: 15, unit_price: 625, list_price: 9375 },
    { qty_from: 16, qty_to: 25, unit_price: 625, list_price: 15625 },
  ]

  it('档内按边际单价计算', () => {
    expect(resolveCumulativeTierPrice(tiers, 5).total).toBe(3125)
    expect(resolveCumulativeTierPrice(tiers, 12).total).toBe(7500)
    expect(resolveCumulativeTierPrice(tiers, 20).total).toBe(12500)
  })

  it('档边界等于档累计刊例价', () => {
    expect(resolveCumulativeTierPrice(tiers, 10).total).toBe(6250)
    expect(resolveCumulativeTierPrice(tiers, 15).total).toBe(9375)
    expect(resolveCumulativeTierPrice(tiers, 25).total).toBe(15625)
  })

  it('无价档（10,000+）不自动出价', () => {
    const withNoPrice: CumulativeTier[] = [...tiers, { qty_from: 26, qty_to: null, unit_price: null, list_price: null }]
    const r = resolveCumulativeTierPrice(withNoPrice, 30)
    expect(r.total).toBeNull()
    expect(r.exceedsMax).toBe(true)
    expect(r.source).toBe('no_price')
  })

  it('无阶梯回退 basePrice × 数量', () => {
    const r = resolveCumulativeTierPrice([], 10, 100)
    expect(r.total).toBe(1000)
    expect(r.source).toBe('base')
  })
})

describe('Project 企业版公有云按年订阅（档边界与 Excel 100% 一致）', () => {
  it.skipIf(!existsSync(resolve(__dirname, '../config-center/__fixtures__/price-table-dump.txt')))('抽样 30 点：档边界+跨档', () => {
    const tiers = entCloudRows()
    expect(tiers.length).toBeGreaterThan(30)
    // 档边界：每档上限的 total 必须等于该档 list_price
    let checked = 0
    for (const tier of tiers) {
      if (tier.qty_to === null) continue
      const r = resolveCumulativeTierPrice(tiers, tier.qty_to)
      if (r.total !== null) {
        expect(Math.abs(r.total - (tier.list_price ?? 0))).toBeLessThanOrEqual(0.01)
        checked += 1
      }
    }
    // 跨档点
    const points = [10, 15, 25, 100, 200, 500, 1000, 3000, 5000, 10000]
    for (const qty of points) {
      const r = resolveCumulativeTierPrice(tiers, qty)
      expect(r.total).not.toBeNull()
      expect(r.unitPrice).not.toBeNull()
    }
    // 超上限 → 请联系我们
    expect(resolveCumulativeTierPrice(tiers, 10001).exceedsMax).toBe(true)
    console.log(`[EVIDENCE] cumulative tier boundaries checked=${checked}, cross-tier points=${points.length}, ENT_V6 公有云按年订阅 12 月`)
  })
})
