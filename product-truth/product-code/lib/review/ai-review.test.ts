// REQ: F053
// PURPOSE: AI 审核助手提示词构建测试（输入=核验结果，输出要求只总结不编造）
import { describe, expect, it } from 'vitest'
import { buildQuoteReviewAiPrompt, QUOTE_REVIEW_AI_USE_POINT } from './ai-review'
import { reviewQuote, type QuoteReviewInput } from './quote-review'

function base(): QuoteReviewInput {
  return {
    quote: {
      customer_name: '测试客户',
      currency: 'CNY',
      tax_inclusive: false,
      valid_until: '2026-09-18',
      discount_rate: 0,
      quote_kind: 'STANDARD',
      subtotal: 15000,
      discount_amount: 0,
      tax_amount: 1950,
      total_amount: 16950,
      amount_in_words: '壹万陆仟玖佰伍拾元整',
      region: 'CN',
    },
    items: [{ product_id: 'p1', product_code: 'PROJECT', version_code: 'ENT_V6', deployment: 'PUBLIC_CLOUD', auth_mode: 'SUB_YEAR', term_months: 12, quantity: 10, unit_price: 1500, list_price: 15000, line_total: 15000, line_type: 'product', tax_rate: 0.13, region: 'CN' }],
  }
}

describe('buildQuoteReviewAiPrompt', () => {
  it('包含核验明细与不编造约束', () => {
    const review = reviewQuote(base(), new Date('2026-08-18T12:00:00Z'))
    const prompt = buildQuoteReviewAiPrompt(review, { quote_no: 'QT-1', customer_name: '测试客户', total_amount: 16950, discount_rate: 0, currency: 'CNY' })
    expect(prompt).toContain('QT-1')
    expect(prompt).toContain('核验明细')
    expect(prompt).toContain('不得编造')
  })

  it('use point 注册为 quote.review.assistant', () => {
    expect(QUOTE_REVIEW_AI_USE_POINT).toBe('quote.review.assistant')
  })
})
