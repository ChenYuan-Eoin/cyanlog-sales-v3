import { describe, expect, it } from 'vitest'
import { calculateQuoteTotals, resolveProductUnitPrice, validatePriceTiers } from './engine'

describe('pricing engine', () => {
  it('按数量命中阶梯价', () => {
    const result = resolveProductUnitPrice({
      id: 'prod-1',
      code: 'PROD-001',
      name: '测试产品',
      base_price: 100,
      min_price: 80,
      tier_pricing_enabled: true,
      product_price_tiers: [
        { qty_from: 1, qty_to: 10, unit_price: 100, sort_order: 0 },
        { qty_from: 11, qty_to: 20, unit_price: 90, sort_order: 1 },
        { qty_from: 21, qty_to: null, unit_price: 85, sort_order: 2 },
      ],
    }, 12)

    expect(result.unitPrice).toBe(90)
    expect(result.source).toBe('tier')
    expect(result.tier?.qty_from).toBe(11)
  })

  it('校验阶梯价重叠', () => {
    const error = validatePriceTiers([
      { qty_from: 1, qty_to: 10, unit_price: 100, sort_order: 0 },
      { qty_from: 10, qty_to: 20, unit_price: 95, sort_order: 1 },
    ], 80)

    expect(error).toContain('不能重叠')
  })

  it('计算报价汇总', () => {
    const totals = calculateQuoteTotals({
      subtotal: 1000,
      discountRate: 5,
      taxRate: 0.13,
    })

    expect(totals.discountAmount).toBe(50)
    expect(totals.taxAmount).toBe(123.5)
    expect(totals.totalAmount).toBe(1073.5)
  })
})
