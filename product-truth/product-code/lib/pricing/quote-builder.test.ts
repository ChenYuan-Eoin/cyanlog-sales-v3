// REQ: F037/F038/F045
// PURPOSE: 报价构建纯逻辑测试（组合校验/分税/赠送/中文大写）
import { describe, expect, it } from 'vitest'
import {
  validateProductCombination,
  computeQuoteTotals,
  numberToChineseUpper,
  buildQuoteLine,
  type QuoteLineInput,
  type QuoteLineResult,
} from './quote-builder'
import type { CumulativeTier } from './cumulative'

const ENT_TIERS: CumulativeTier[] = [
  { qty_from: 1, qty_to: 10, unit_price: 1500, list_price: 15000 },
  { qty_from: 11, qty_to: 15, unit_price: 1500, list_price: 22500 },
  { qty_from: 16, qty_to: 25, unit_price: 1500, list_price: 37500 },
]

function line(partial: Partial<QuoteLineInput> & { productCode: string }): QuoteLineInput {
  return {
    productId: partial.productCode,
    category: 'BASE',
    follows: [],
    versionCode: 'ENT_V6',
    deployment: 'PUBLIC_CLOUD',
    authMode: 'SUB_YEAR',
    termMonths: 12,
    quantity: 10,
    tiers: ENT_TIERS,
    ...partial,
  }
}

describe('validateProductCombination（F037 搭售/跟随/生态账号数）', () => {
  it('跟随产品缺少基座 → 报错', () => {
    const issues = validateProductCombination([
      line({ productCode: 'COPILOT', category: 'FOLLOW_PRODUCT', follows: ['PROJECT'] }),
    ])
    expect(issues.some((i) => i.code === 'BASE_MISSING')).toBe(true)
  })

  it('≥2 款核心组合版本不一致 → 报错', () => {
    const issues = validateProductCombination([
      line({ productCode: 'PROJECT' }),
      line({ productCode: 'DESK', category: 'FOLLOW_APP', follows: ['PROJECT'], versionCode: 'PRO_V6' }),
    ])
    expect(issues.some((i) => i.code === 'VERSION_MISMATCH')).toBe(true)
  })

  it('WPS 账号数 ≠ Wiki 账号数 → 报错（原型反复出 bug 的规则）', () => {
    const issues = validateProductCombination([
      line({ productCode: 'WIKI', quantity: 50 }),
      line({ productCode: 'WPS', category: 'FOLLOW_ECO', follows: ['WIKI'], quantity: 10 }),
    ])
    expect(issues.some((i) => i.code === 'ECO_QTY_MISMATCH')).toBe(true)
  })

  it('组合合法 → 无问题', () => {
    const issues = validateProductCombination([
      line({ productCode: 'PROJECT', quantity: 50 }),
      line({ productCode: 'COPILOT', category: 'FOLLOW_PRODUCT', follows: ['PROJECT'], quantity: 50 }),
    ])
    expect(issues).toEqual([])
  })
})

describe('F048 内部毛利计算', () => {
  it('buildQuoteLine 带成本 → 行毛利正确', () => {
    const line = buildQuoteLine({
      productId: 'p1', productCode: 'PROJECT', category: 'BASE', follows: [], versionCode: 'ENT_V6',
      deployment: 'PUBLIC_CLOUD', authMode: 'SUB_YEAR', termMonths: 12, quantity: 10, costPrice: 800,
      tiers: [{ qty_from: 1, qty_to: null, unit_price: 1500, list_price: 15000 }],
    }, 0)
    expect(line.marginRate).toBeCloseTo((1500 - 800) / 1500, 4)
    expect(line.lineCost).toBe(8000)
  })

  it('computeQuoteTotals 汇总整单毛利', () => {
    const lines: QuoteLineResult[] = [{
      lineNo: 1, productCode: 'PROJECT', quantity: 10, unitPrice: 1500, listPrice: 15000, subtotal: 15000,
      isGift: false, giftOriginalAmount: null, taxRate: 0.13, taxAmount: 0, source: 'cumulative', noPrice: false,
      costPrice: 800, floorPrice: 600, lineCost: 8000, marginRate: (1500 - 800) / 1500,
    }]
    const t = computeQuoteTotals({ lines, discountRate: 0.1, softwareTaxRate: 0.13, serviceTaxRate: 0.06 })
    expect(t.totalCost).toBe(8000)
    expect(t.marginRate).toBeCloseTo((13500 - 8000) / 13500, 4)
  })
})

describe('computeQuoteTotals（F045 分税/赠送/大写）', () => {
  function makeLine(partial: Partial<QuoteLineResult>): QuoteLineResult {
    return {
      lineNo: 1,
      productCode: 'PROJECT',
      quantity: 10,
      unitPrice: 1500,
      listPrice: 15000,
      subtotal: 15000,
      isGift: false,
      giftOriginalAmount: null,
      taxRate: null,
      taxAmount: null,
      source: 'cumulative',
      noPrice: false,
      costPrice: null,
      floorPrice: null,
      lineCost: null,
      marginRate: null,
      ...partial,
    }
  }

  it('软件 13% 与服务 6% 分开计税，整单折扣后计算', () => {
    const totals = computeQuoteTotals({
      lines: [
        makeLine({ lineNo: 1, productCode: 'PROJECT', subtotal: 10000 }),
        makeLine({ lineNo: 2, productCode: 'SVC_IMPLEMENT', subtotal: 2000 }),
      ],
      discountRate: 0.1,
      softwareTaxRate: 0.13,
      serviceTaxRate: 0.06,
    })
    expect(totals.subtotal).toBe(12000)
    expect(totals.discountAmount).toBe(1200)
    expect(totals.softwareTaxAmount).toBe(1170)   // 9000 × 13%
    expect(totals.serviceTaxAmount).toBe(108)     // 1800 × 6%
    expect(totals.taxAmount).toBe(1278)
    expect(totals.grandTotal).toBe(12078)
  })

  it('赠送行不计入总价，但保留赠送前应收', () => {
    const totals = computeQuoteTotals({
      lines: [
        makeLine({ lineNo: 1, productCode: 'PROJECT', subtotal: 10000 }),
        makeLine({ lineNo: 2, productCode: 'WIKI', subtotal: 5000, isGift: true, giftOriginalAmount: 5000 }),
      ],
      discountRate: 0,
      softwareTaxRate: 0.13,
      serviceTaxRate: 0.06,
    })
    expect(totals.subtotal).toBe(10000)
    expect(totals.grandTotal).toBe(11300)
  })

  it('10,000+ 无价行（no_price）不计入汇总', () => {
    const totals = computeQuoteTotals({
      lines: [makeLine({ lineNo: 1, productCode: 'PROJECT', subtotal: null, noPrice: true })],
      discountRate: 0,
      softwareTaxRate: 0.13,
      serviceTaxRate: 0.06,
    })
    expect(totals.subtotal).toBe(0)
  })
})

describe('numberToChineseUpper（F045 中文大写）', () => {
  it('整数', () => {
    expect(numberToChineseUpper(12345)).toBe('壹万贰仟叁佰肆拾伍元整')
  })
  it('带角分', () => {
    expect(numberToChineseUpper(12345.67)).toBe('壹万贰仟叁佰肆拾伍元陆角柒分')
  })
  it('零元', () => {
    expect(numberToChineseUpper(0)).toBe('零元整')
  })
  it('跨万组补零', () => {
    expect(numberToChineseUpper(100000001)).toBe('壹亿零壹元整')
  })
})

describe('buildQuoteLine（F038 累计计价）', () => {
  it('档边界 = 档累计刊例价', () => {
    const item = line({ productCode: 'PROJECT', quantity: 15 })
    const result = buildQuoteLine(item, 0)
    expect(result.subtotal).toBe(22500)
    expect(result.unitPrice).toBe(1500)
    expect(result.source).toBe('cumulative')
  })
  it('10,000+ 无价 → noPrice', () => {
    const item = line({ productCode: 'PROJECT', quantity: 10001 })
    const result = buildQuoteLine(item, 0)
    expect(result.noPrice).toBe(true)
    expect(result.subtotal).toBeNull()
  })
})
