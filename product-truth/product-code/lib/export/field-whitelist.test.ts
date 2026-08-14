// REQ: F029/F030
// PURPOSE: 输出白名单测试（内部字段零泄漏硬门）
import { describe, expect, it } from 'vitest'
import { pickWhitelisted, deriveWhitelistFromDictionary } from './field-whitelist'

const QUOTE_DATA = {
  quote_no: 'QT-20260814-0001',
  customer_name: '安谋科技',
  grand_total: 12078,
  total_in_words: '壹万贰仟零柒拾捌元整',
  line_items: [
    { name: 'ONES Project', unit_price: 1500, quantity: 10, internal_cost: 800, margin_rate: 0.47 },
  ],
  internal_cost: 8000,
  min_price: 9000,
  margin_rate: 0.3,
  approver: '王雪婧',
  approval_opinion: '同意',
}

describe('pickWhitelisted', () => {
  it('allowlist 模式只保留白名单字段，内部字段物理剔除（含嵌套）', () => {
    const whitelist = ['quote_no', 'customer_name', 'grand_total', 'total_in_words', 'line_items', 'name', 'unit_price', 'quantity']
    const out = pickWhitelisted(QUOTE_DATA, whitelist) as Record<string, unknown>
    expect(out.internal_cost).toBeUndefined()
    expect(out.min_price).toBeUndefined()
    expect(out.approver).toBeUndefined()
    expect(out.approval_opinion).toBeUndefined()
    const item = (out.line_items as Array<Record<string, unknown>>)[0]
    expect(item.internal_cost).toBeUndefined()
    expect(item.margin_rate).toBeUndefined()
    expect(item.unit_price).toBe(1500)
  })

  it('denylist 模式：白名单为空时按默认内部字段黑名单剔除', () => {
    const out = pickWhitelisted(QUOTE_DATA, [], 'denylist') as Record<string, unknown>
    expect(out.internal_cost).toBeUndefined()
    expect(out.min_price).toBeUndefined()
    expect(out.margin_rate).toBeUndefined()
    expect(out.approver).toBeUndefined()
    expect(out.grand_total).toBe(12078)
  })

  it('嵌套内部字段递归剔除', () => {
    const out = pickWhitelisted(QUOTE_DATA, ['line_items', 'name', 'unit_price', 'quantity']) as Record<string, unknown>
    const item = (out.line_items as Array<Record<string, unknown>>)[0]
    expect(item.internal_cost).toBeUndefined()
    expect(item.margin_rate).toBeUndefined()
  })
})

describe('deriveWhitelistFromDictionary', () => {
  it('只取 is_external=true 的字段', () => {
    const fields = [
      { field_key: 'grand_total', is_external: true },
      { field_key: 'internal_cost', is_external: false },
      { field_key: 'approver', is_external: false },
    ]
    const whitelist = deriveWhitelistFromDictionary(fields)
    expect(whitelist).toContain('grand_total')
    expect(whitelist).not.toContain('internal_cost')
    expect(whitelist).not.toContain('approver')
  })
})
