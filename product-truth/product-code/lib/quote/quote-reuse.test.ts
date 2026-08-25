// REQ: WP10 阶段2
import { describe, expect, it } from 'vitest'
import { buildReusedQuoteItem } from './quote-reuse'

describe('buildReusedQuoteItem（报价复用继承语义）', () => {
  it('业务事实继承：产品/版本/部署/授权/期限/数量/行类型', () => {
    const item = buildReusedQuoteItem({
      product_id: 'p1',
      product_code: 'PROJECT',
      name: 'ONES Project',
      version_code: 'ENT_V6',
      deployment: 'PRIVATE',
      auth_mode: 'SUB_YEAR',
      term_months: 12,
      quantity: 50,
      line_type: 'product',
      region: 'CN',
    }, 'CN')
    expect(item.product_id).toBe('p1')
    expect(item.version_code).toBe('ENT_V6')
    expect(item.deployment).toBe('PRIVATE')
    expect(item.auth_mode).toBe('SUB_YEAR')
    expect(item.quantity).toBe(50)
    expect(item.line_type).toBe('product')
  })

  it('价格不继承：unit_price/line_total 重置为 0，历史价只作 list_price 参照', () => {
    const item = buildReusedQuoteItem({
      name: 'X',
      quantity: 10,
      unit_price: 1500,
      list_price: 15000,
      line_total: 12000,
    }, null)
    expect(item.unit_price).toBe(0)
    expect(item.line_total).toBe(0)
    expect(item.discount).toBe(0)
    expect(item.list_price).toBe(15000)  // 历史价参照
  })

  it('审批/商务状态重置：is_gift=false、折扣原因不继承、成本毛利重置', () => {
    const item = buildReusedQuoteItem({
      name: 'X',
      quantity: 10,
      is_gift: true,
      gift_original_amount: 5000,
      cost_price: 800,
      floor_price: 600,
    }, null)
    expect(item.is_gift).toBe(false)
    expect(item.gift_original_amount).toBeNull()
    expect(item.cost_price).toBeNull()
    expect(item.floor_price).toBeNull()
  })

  it('区域继承：明细无区域时用源报价区域', () => {
    const item = buildReusedQuoteItem({ name: 'X', quantity: 1 }, 'US')
    expect(item.region).toBe('US')
  })

  it('自定义行 product_type 保留', () => {
    const item = buildReusedQuoteItem({ product_type: 'custom', name: '实施服务', quantity: 5, unit_price: 2000 }, null)
    expect(item.product_type).toBe('custom')
    expect(item.unit_price).toBe(0)
  })
})
