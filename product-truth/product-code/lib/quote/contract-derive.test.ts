// REQ: WP10 阶段4
import { describe, expect, it } from 'vitest'
import { deriveContractFromVersion, assertVersionMatchesQuote } from './contract-derive'
import type { QuoteVersionPayload } from './version-builder'

const version: QuoteVersionPayload = {
  quote_no: 'QT-20260820-1053',
  version_no: 1,
  header: {
    quote_no: 'QT-20260820-1053',
    customer_name: '深圳市云启数字科技有限公司',
    customer_contact: '张三',
    currency: 'CNY',
    exchange_rate: 6.7808,
    discount_rate: 0.4,
    subtotal: 15000,
    discount_amount: 6000,
    tax_amount: 1170,
    total_amount: 10170,
    tax_summary: { software: 1170, service: 0 },
    valid_until: '2026-09-04',
    notes: null,
  },
  items: [
    {
      product_code: 'PROJECT',
      name: 'ONES Project 项目管理平台',
      version_code: 'ENT_V6',
      deployment: 'PUBLIC_CLOUD',
      auth_mode: 'SUB_YEAR',
      term_months: 12,
      quantity: 10,
      unit_price: 1500,
      list_price: 15000,
      discount: 6000,
      line_total: 10170,
      tax_rate: 0.13,
      tax_amount: 1170,
      is_gift: false,
      gift_original_amount: null,
      maintenance_months: null,
      version_from: null,
      version_to: null,
      pricing_source: 'cumulative',
      tier_range: null,
    },
  ],
}

describe('deriveContractFromVersion（阶段4 字段逐位一致）', () => {
  it('金额/税/客户/明细与版本逐位一致，不做改写', () => {
    const d = deriveContractFromVersion({
      quote_no: version.quote_no,
      customer_name: version.header.customer_name,
      customer_contact: version.header.customer_contact,
      currency: version.header.currency,
      version,
    })
    expect(d.contract_amount).toBe(10170)
    expect(d.tax_amount).toBe(1170)
    expect(d.party_b_name).toBe('深圳市云启数字科技有限公司')
    expect(d.business_params.line_items).toHaveLength(1)
    expect(d.business_params.line_items[0].quantity).toBe(10)
    expect(d.business_params.line_items[0].line_total).toBe(10170)
    expect(d.business_params.discount_rate).toBe(0.4)
    expect(d.business_params.version_no).toBe(1)
  })

  it('防漂移：版本与报价金额不一致 → 拒绝', () => {
    expect(assertVersionMatchesQuote(10170, 10170)).toBeNull()
    expect(assertVersionMatchesQuote(10170, 9999)).toMatch(/不一致/)
  })
})
