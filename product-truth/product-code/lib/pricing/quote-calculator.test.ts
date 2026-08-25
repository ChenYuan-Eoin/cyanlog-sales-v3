// REQ: F037/F038/F045
// PURPOSE: 报价计算器整链测试（选品→算价→分税→大写）
import { describe, expect, it } from 'vitest'
import { calculateQuote } from './quote-calculator'
import type { CumulativeTier } from './cumulative'

const ENT_CLOUD_TIERS: CumulativeTier[] = [
  { qty_from: 1, qty_to: 10, unit_price: 1500, list_price: 15000 },
  { qty_from: 11, qty_to: 15, unit_price: 1500, list_price: 22500 },
]

describe('calculateQuote 整链', () => {
  const base = {
    discountRate: 0,
    softwareTaxRate: 0.13,
    serviceTaxRate: 0.06,
    currency: 'CNY',
  }

  it('选品→累计计价→软件税→大写：Project 10 账号企业版公有云', () => {
    const r = calculateQuote({
      ...base,
      lines: [
        {
          productId: 'p1', productCode: 'PROJECT', category: 'BASE' as const, follows: [],
          versionCode: 'ENT_V6', deployment: 'PUBLIC_CLOUD', authMode: 'SUB_YEAR', termMonths: 12,
          quantity: 10, tiers: ENT_CLOUD_TIERS,
        },
      ],
    })
    expect(r.ok).toBe(true)
    expect(r.subtotal).toBe(15000)
    expect(r.softwareTaxAmount).toBe(1950)
    expect(r.taxAmount).toBe(1950)
    expect(r.grandTotal).toBe(16950)
    expect(r.totalInWords).toBe('壹万陆仟玖佰伍拾元整')
  })

  it('WPS 账号数 ≠ Wiki → 拒绝', () => {
    const r = calculateQuote({
      ...base,
      lines: [
        { productId: 'w1', productCode: 'WIKI', category: 'BASE' as const, follows: [], versionCode: 'ENT_V6', deployment: 'PUBLIC_CLOUD', authMode: 'SUB_YEAR', termMonths: 12, quantity: 50, tiers: ENT_CLOUD_TIERS },
        { productId: 'x1', productCode: 'WPS', category: 'FOLLOW_ECO' as const, follows: ['WIKI'], quantityLinkedTo: 'WIKI', versionCode: 'ENT_V6', deployment: 'PUBLIC_CLOUD', authMode: 'SUB_YEAR', termMonths: 12, quantity: 10, tiers: ENT_CLOUD_TIERS },
      ],
    })
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.code === 'ECO_QTY_MISMATCH')).toBe(true)
  })

  it('10,000+ 无价 → noPrice 拒绝自动出价', () => {
    const r = calculateQuote({
      ...base,
      lines: [
        { productId: 'p1', productCode: 'PROJECT', category: 'BASE' as const, follows: [], versionCode: 'ENT_V6', deployment: 'PUBLIC_CLOUD', authMode: 'SUB_YEAR', termMonths: 12, quantity: 10001, tiers: ENT_CLOUD_TIERS },
      ],
    })
    expect(r.ok).toBe(false)
    expect(r.noPrice).toBe(true)
  })

  it('赠送行不计总价', () => {
    const r = calculateQuote({
      ...base,
      lines: [
        { productId: 'p1', productCode: 'PROJECT', category: 'BASE' as const, follows: [], versionCode: 'ENT_V6', deployment: 'PUBLIC_CLOUD', authMode: 'SUB_YEAR', termMonths: 12, quantity: 10, tiers: ENT_CLOUD_TIERS },
        { productId: 'w1', productCode: 'WIKI', category: 'BASE' as const, follows: [], versionCode: 'ENT_V6', deployment: 'PUBLIC_CLOUD', authMode: 'SUB_YEAR', termMonths: 12, quantity: 10, tiers: ENT_CLOUD_TIERS, isGift: true },
      ],
    })
    expect(r.ok).toBe(true)
    expect(r.subtotal).toBe(15000)
  })
})
