// REQ: F047
// PURPOSE: 报价审核自动化核验引擎测试（审核点 → 自动判定）
import { describe, expect, it } from 'vitest'
import { reviewQuote, type QuoteReviewInput } from './quote-review'

const NOW = new Date('2026-08-18T12:00:00Z')
const VERSIONS = [
  { version_code: 'ENT_V6', deployments: ['PUBLIC_CLOUD', 'PRIVATE', 'HA'], auth_modes: ['SUB_YEAR', 'SUB_3YEAR', 'ONETIME'], status: 'PUBLISHED' },
  { version_code: 'STD_V6', deployments: ['PUBLIC_CLOUD'], auth_modes: ['SUB_YEAR'], status: 'PUBLISHED' },
]

function base(): QuoteReviewInput {
  return {
    quote: {
      customer_name: '深圳复临科技有限公司',
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
      total_cost: 8000,
      margin_rate: 0.4667,
      region: 'CN',
    },
    items: [
      {
        product_id: 'p1',
        product_code: 'PROJECT',
        name: 'ONES Project',
        version_code: 'ENT_V6',
        deployment: 'PUBLIC_CLOUD',
        auth_mode: 'SUB_YEAR',
        term_months: 12,
        quantity: 10,
        unit_price: 1500,
        list_price: 15000,
        line_total: 15000,
        line_type: 'product',
        tax_rate: 0.13,
        subscription_start: '2026-08-18',
        subscription_end: '2027-08-17',
        version_from: null,
        version_to: null,
        cost_price: 800,
        line_cost: 8000,
        region: 'CN',
      },
    ],
    versions: VERSIONS,
    products: { p1: { code: 'PROJECT', attributes: { category: 'BASE', follows: [] } } },
  }
}



describe('reviewQuote 基础', () => {
  it('完整合规报价 → PASS', () => {
    const r = reviewQuote(base(), NOW)
    expect(r.status).toBe('PASS')
    expect(r.blocked).toHaveLength(0)
  })

  it('抬头含占位词 → BLOCK HEADER_REAL', () => {
    const q = base(); q.quote.customer_name = '测试客户'
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('HEADER_REAL')
  })

  it('行缺版本/部署/授权 → BLOCK LINE_COMPLETE', () => {
    const q = base(); q.items[0].version_code = ''; q.items[0].auth_mode = ''
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('LINE_COMPLETE')
  })

  it('计算不一致 → BLOCK CALC_ACCURATE', () => {
    const q = base(); q.quote.subtotal = 16000
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('CALC_ACCURATE')
  })

  it('大写与总额不符 → BLOCK AMOUNT_IN_WORDS', () => {
    const q = base(); q.quote.amount_in_words = '壹万元整'
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('AMOUNT_IN_WORDS')
  })

  it('未生成大写 → WARN AMOUNT_IN_WORDS', () => {
    const q = base(); q.quote.amount_in_words = ''
    const r = reviewQuote(q, NOW)
    expect(r.status).toBe('WARN')
    expect(r.warnings.map((c) => c.code)).toContain('AMOUNT_IN_WORDS')
  })

  it('版本不在可售目录 → BLOCK VERSION_SELLABLE', () => {
    const q = base(); q.items[0].version_code = 'V7'
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('VERSION_SELLABLE')
  })

  it('版本允许范围外部署/授权 → BLOCK VERSION_SELLABLE', () => {
    const q = base(); q.items[0].deployment = 'HA'; q.items[0].auth_mode = 'ONETIME' // ENT_V6 允许，改 STD_V6
    q.items[0].version_code = 'STD_V6'
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('VERSION_SELLABLE')
  })

  it('私有化缺维保 → BLOCK PRIVATE_MAINT', () => {
    const q = base(); q.items[0].deployment = 'PRIVATE'
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('PRIVATE_MAINT')
  })

  it('私有化有维保月数 → 通过 PRIVATE_MAINT', () => {
    const q = base(); q.items[0].deployment = 'PRIVATE'; q.items[0].maintenance_months = 12
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).not.toContain('PRIVATE_MAINT')
  })

  it('订阅缺起止日期 → BLOCK SUBSCRIBE_DATE', () => {
    const q = base(); q.items[0].subscription_start = null; q.items[0].subscription_end = null
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('SUBSCRIBE_DATE')
  })

  it('有折扣缺原因 → BLOCK DISCOUNT_REASON', () => {
    const q = base(); q.quote.discount_rate = 0.1
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('DISCOUNT_REASON')
  })

  it('折扣有原因 → 通过 DISCOUNT_REASON', () => {
    const q = base(); q.quote.discount_rate = 0.1; q.quote.discount_reason = '老客户续约优惠'
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).not.toContain('DISCOUNT_REASON')
  })

  it('行小计低于刊例价 50% → BLOCK DISCOUNT_GOVERNANCE', () => {
    const q = base(); q.items[0].unit_price = 500; q.items[0].line_total = 5000
    q.quote.subtotal = 5000; q.quote.tax_amount = 650; q.quote.total_amount = 5650; q.quote.amount_in_words = '伍仟陆佰伍拾元整'
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('DISCOUNT_GOVERNANCE')
  })

  it('行小计低于刊例价 80% → WARN DISCOUNT_GOVERNANCE', () => {
    const q = base(); q.items[0].unit_price = 1100; q.items[0].line_total = 11000
    q.quote.subtotal = 11000; q.quote.tax_amount = 1430; q.quote.total_amount = 12430; q.quote.amount_in_words = '壹万贰仟肆佰叁拾元整'
    const r = reviewQuote(q, NOW)
    expect(r.warnings.map((c) => c.code)).toContain('DISCOUNT_GOVERNANCE')
  })

  it('分项区域与报价区域不一致 → BLOCK REGION_CONSISTENCY', () => {
    const q = base(); q.items[0].region = 'US'
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('REGION_CONSISTENCY')
  })

  it('缺成本数据 → WARN MARGIN_FLOOR', () => {
    const q = base(); q.quote.total_cost = 0; q.quote.margin_rate = null; q.items[0].cost_price = 0; q.items[0].line_cost = 0
    const r = reviewQuote(q, NOW)
    expect(r.warnings.map((c) => c.code)).toContain('MARGIN_FLOOR')
  })

  it('毛利率低于成本 → BLOCK MARGIN_FLOOR', () => {
    const q = base(); q.quote.total_cost = 18000; q.quote.margin_rate = -0.1
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('MARGIN_FLOOR')
  })

  it('毛利率低于底线 30% → WARN MARGIN_FLOOR', () => {
    const q = base(); q.quote.total_cost = 12000; q.quote.margin_rate = 0.2
    const r = reviewQuote(q, NOW)
    expect(r.warnings.map((c) => c.code)).toContain('MARGIN_FLOOR')
  })

  it('有效期过期 → BLOCK VALID_UNTIL', () => {
    const q = base(); q.quote.valid_until = '2026-08-01'
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('VALID_UNTIL')
  })
})

describe('reviewQuote 场景规则组', () => {
  it('UPGRADE 缺原/新版本 → BLOCK SCENE_UPGRADE', () => {
    const q = base(); q.quote.quote_kind = 'UPGRADE'
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('SCENE_UPGRADE')
  })

  it('UPGRADE 有 version_from/to → 通过', () => {
    const q = base(); q.quote.quote_kind = 'UPGRADE'; q.items[0].version_from = 'STD_V6'; q.items[0].version_to = 'ENT_V6'
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).not.toContain('SCENE_UPGRADE')
  })

  it('DEV 行缺说明 → BLOCK SCENE_DEV', () => {
    const q = base(); q.quote.quote_kind = 'DEV'
    q.items[0].line_type = 'dev'; q.items[0].line_note = ''
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('SCENE_DEV')
  })

  it('GIFT 行缺标准价值 → BLOCK SCENE_GIFT', () => {
    const q = base(); q.quote.quote_kind = 'GIFT'; q.items[0].is_gift = true; q.items[0].gift_original_amount = 0
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('SCENE_GIFT')
  })

  it('CHANGE 缺变更原因 → BLOCK SCENE_CHANGE', () => {
    const q = base(); q.quote.quote_kind = 'CHANGE'
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('SCENE_CHANGE')
  })

  it('INSTALLMENT 分期比例不足 100% → BLOCK SCENE_INSTALLMENT', () => {
    const q = base(); q.quote.quote_kind = 'INSTALLMENT'; q.quote.attributes = { payment_plan: [{ ratio: 50 }, { ratio: 30 }] }
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('SCENE_INSTALLMENT')
  })

  it('SPECIAL_DISCOUNT 缺原因 → BLOCK SCENE_SPECIAL_DISCOUNT', () => {
    const q = base(); q.quote.quote_kind = 'SPECIAL_DISCOUNT'
    const r = reviewQuote(q, NOW)
    expect(r.blocked.map((c) => c.code)).toContain('SCENE_SPECIAL_DISCOUNT')
  })
})
