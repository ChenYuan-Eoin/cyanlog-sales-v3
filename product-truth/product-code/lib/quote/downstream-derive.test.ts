// REQ: WP10 阶段4/7
import { describe, expect, it } from 'vitest'
import { buildDownstreamParams, type DeriveSource } from './downstream-derive'

const source: DeriveSource = {
  quote_id: 'q1',
  org_id: 'org1',
  quote_no: 'QT-20260820-1053',
  customer_name: '深圳市云启数字科技有限公司',
  customer_contact: '张三',
  currency: 'CNY',
  version: {
    id: 'v1',
    version_no: 1,
    header: { subtotal: 15000, discount_amount: 6000, tax_amount: 1170, total_amount: 10170, discount_rate: 0.4, tax_summary: { software: 1170 }, valid_until: '2026-09-04' },
    items: [{ product_code: 'PROJECT', name: 'ONES Project', quantity: 10, unit_price: 1500, list_price: 15000, line_total: 10170, tax_rate: 0.13, is_gift: false }],
  },
}

describe('buildDownstreamParams（下游派生字段逐位一致）', () => {
  it('业务参数包含版本金额/税/明细行，逐位一致', () => {
    const p = buildDownstreamParams(source)
    expect(p.quote_no).toBe('QT-20260820-1053')
    expect(p.version_no).toBe(1)
    expect(p.discount_rate).toBe(0.4)
    expect(p.tax_summary).toEqual({ software: 1170 })
    const items = p.line_items as Array<Record<string, unknown>>
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ product_code: 'PROJECT', quantity: 10, line_total: 10170, tax_rate: 0.13 })
  })

  it('明细字段白名单：不携带内部成本/毛利字段', () => {
    const rich: DeriveSource = {
      ...source,
      version: {
        ...source.version,
        items: [{ ...source.version.items[0], cost_price: 800, floor_price: 600, margin_rate: 0.5 }],
      },
    }
    const p = buildDownstreamParams(rich)
    const item = (p.line_items as Array<Record<string, unknown>>)[0]
    expect(item.cost_price).toBeUndefined()
    expect(item.floor_price).toBeUndefined()
    expect(item.margin_rate).toBeUndefined()
  })
})
