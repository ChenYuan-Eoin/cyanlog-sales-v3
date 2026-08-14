// REQ: F034
// PURPOSE: 冻结版本 payload 构建测试（结构化可读 = 合同源数据）
import { describe, expect, it } from 'vitest'
import { buildQuoteVersionPayload, checksumOfVersion } from './version-builder'

const QUOTE = {
  quote_no: 'QT-20260814-0001',
  customer_name: '安谋科技',
  currency: 'CNY',
  discount_rate: 0.1,
  subtotal: 15000,
  discount_amount: 1500,
  tax_amount: 1755,
  total_amount: 15255,
}
const ITEMS = [
  {
    product_code: 'PROJECT',
    name: 'ONES Project 企业版 V6',
    version_code: 'ENT_V6',
    deployment: 'PUBLIC_CLOUD',
    auth_mode: 'SUB_YEAR',
    term_months: 12,
    quantity: 10,
    unit_price: 1500,
    list_price: 15000,
    line_total: 15000,
    is_gift: false,
  },
]

describe('buildQuoteVersionPayload（F034 结构化源数据）', () => {
  it('header+items 全字段结构化可读，价格/数量/版本/部署/授权/期限齐全', () => {
    const payload = buildQuoteVersionPayload(QUOTE, ITEMS, 1)
    expect(payload.version_no).toBe(1)
    expect(payload.header.customer_name).toBe('安谋科技')
    expect(payload.items[0]).toMatchObject({
      product_code: 'PROJECT',
      version_code: 'ENT_V6',
      deployment: 'PUBLIC_CLOUD',
      auth_mode: 'SUB_YEAR',
      term_months: 12,
      quantity: 10,
      unit_price: 1500,
      list_price: 15000,
    })
    expect(payload.items[0].is_gift).toBe(false)
  })

  it('checksum 稳定：同一 payload 同指纹，字段变化不同', () => {
    const a = buildQuoteVersionPayload(QUOTE, ITEMS, 1)
    const b = buildQuoteVersionPayload(QUOTE, ITEMS, 1)
    expect(checksumOfVersion(a)).toBe(checksumOfVersion(b))
    const changed = buildQuoteVersionPayload(QUOTE, [{ ...ITEMS[0], quantity: 11 }], 1)
    expect(checksumOfVersion(a)).not.toBe(checksumOfVersion(changed))
  })

  it('缺失字段容错（未迁移库也可构建）', () => {
    const payload = buildQuoteVersionPayload({ quote_no: 'Q1', customer_name: 'x' }, [], 1)
    expect(payload.header.currency).toBe('CNY')
    expect(payload.items).toEqual([])
  })
})
