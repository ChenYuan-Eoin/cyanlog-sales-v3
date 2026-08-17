// REQ: F039/F040
// PURPOSE: 标准单导出脱敏测试（内部字段零泄漏硬门）
import { describe, expect, it } from 'vitest'
import { buildQuoteExportData } from './quote-export'

const QUOTE = {
  quoteNo: 'QT-20260814-0001',
  customerName: '安谋科技',
  validUntil: '2026-08-29',
  currency: 'CNY',
  subtotal: 15000,
  discountRate: 0,
  discountAmount: 0,
  taxAmount: 1950,
  totalAmount: 16950,
  totalInWords: '壹万陆仟玖佰伍拾元整',
  taxSummary: { software: 1950, service: 0 },
  items: [
    {
      name: 'ONES Project 企业版 V6',
      version_code: 'ENT_V6',
      deployment: 'PUBLIC_CLOUD',
      auth_mode: 'SUB_YEAR',
      term_months: 12,
      quantity: 10,
      unit_price: 1500,
      list_price: 15000,
      line_total: 15000,
      internal_cost: 8000,
      margin_rate: 0.47,
    },
  ],
  notes: '内部备注',
}

describe('buildQuoteExportData', () => {
  it('内部字段（成本/毛利）不进入导出数据（含嵌套）', () => {
    const r = buildQuoteExportData(QUOTE)
    expect(r.ok).toBe(true)
    const json = JSON.stringify(r.data)
    expect(json).not.toContain('internal_cost')
    expect(json).not.toContain('margin_rate')
    expect(json).not.toContain('notes')
    expect(r.data?.total_in_words).toBe('壹万陆仟玖佰伍拾元整')
    expect((r.data?.items as Array<Record<string, unknown>>)[0].name).toContain('ONES Project')
  })

  it('含水印与生成时间', () => {
    const r = buildQuoteExportData(QUOTE)
    expect(r.data?.watermark).toContain('脱敏')
    expect(r.data?.generated_at).toBeTruthy()
  })
})
