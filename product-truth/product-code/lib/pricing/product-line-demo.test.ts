// WP10 硬指标：换产品线演示——非 ONES 产品线只配数据、零代码改动跑通
// 场景：客户 B 是一家教育 SaaS 公司，产品线 "EDU"：
//   基座 LMS（订阅）+ 生态应用 AI 批改（账号数联动 LMS）+ 实施服务（服务税）
// 验证：同一 calculateQuote 引擎，仅靠配置数据（产品属性/价盘/税率）即可正确算价
import { describe, expect, it } from 'vitest'
import { calculateQuote } from './quote-calculator'
import { validateProductCombination, computeQuoteTotals, type QuoteLineInput, type QuoteLineResult } from './quote-builder'

// 客户 B 产品线配置（模拟配置中心数据，非 ONES）
const EDU_LMS_TIERS = [
  { qty_from: 1, qty_to: 50, unit_price: 200, list_price: 10000 },
  { qty_from: 51, qty_to: 200, unit_price: 180, list_price: 37000 },
  { qty_from: 201, qty_to: null, unit_price: 150, list_price: 64000 },
]

describe('换产品线演示（EDU 客户B，非 ONES，零代码改动）', () => {
  it('EDU LMS 订阅 + AI 批改（账号数联动）+ 实施服务 正确算价', () => {
    const lines: QuoteLineInput[] = [
      // 基座 LMS：50 账号订阅
      { productId: 'edu-lms', productCode: 'LMS', category: 'BASE', follows: [], versionCode: 'EDU_V2', deployment: 'PUBLIC_CLOUD', authMode: 'SUB_YEAR', termMonths: 12, quantity: 50, tiers: EDU_LMS_TIERS, taxCategory: 'software' },
      // 生态应用 AI 批改：quantityLinkedTo LMS（配置数据，非代码写死）
      { productId: 'edu-grader', productCode: 'AI_GRADER', category: 'FOLLOW_ECO', follows: ['LMS'], quantityLinkedTo: 'LMS', versionCode: 'EDU_V2', deployment: 'PUBLIC_CLOUD', authMode: 'SUB_YEAR', termMonths: 12, quantity: 50, tiers: EDU_LMS_TIERS, taxCategory: 'software' },
      // 实施服务：服务税
      { productId: 'edu-svc', productCode: 'SVC_IMPL', category: 'BASE', follows: [], versionCode: 'EDU_V2', deployment: 'PUBLIC_CLOUD', authMode: 'SUB_YEAR', termMonths: 12, quantity: 10, priceOverride: 500, taxCategory: 'service' },
    ]
    const r = calculateQuote({ lines, discountRate: 0, softwareTaxRate: 0.13, serviceTaxRate: 0.06, currency: 'CNY' })
    expect(r.ok).toBe(true)
    expect(r.subtotal).toBe(25000)          // LMS 10000 + AI_GRADER 10000 + SVC 5000
    expect(r.softwareTaxAmount).toBe(2600)  // 软件 (10000+10000) × 13%
    expect(r.serviceTaxAmount).toBe(300)    // 服务 5000 × 6%
    expect(r.grandTotal).toBe(27900)        // 25000 + 2600 + 300
    expect(r.totalInWords).toBe('贰万柒仟玖佰元整')
  })

  it('AI 批改账号数 ≠ LMS 账号数 → ECO_QTY_MISMATCH（机制来自 quantityLinkedTo 配置）', () => {
    const issues = validateProductCombination([
      { productId: 'edu-lms', productCode: 'LMS', category: 'BASE', follows: [], versionCode: 'EDU_V2', deployment: 'PUBLIC_CLOUD', authMode: 'SUB_YEAR', termMonths: 12, quantity: 50, taxCategory: 'software' },
      { productId: 'edu-grader', productCode: 'AI_GRADER', category: 'FOLLOW_ECO', follows: ['LMS'], quantityLinkedTo: 'LMS', versionCode: 'EDU_V2', deployment: 'PUBLIC_CLOUD', authMode: 'SUB_YEAR', termMonths: 12, quantity: 30, taxCategory: 'software' },
    ])
    expect(issues.some((i) => i.code === 'ECO_QTY_MISMATCH')).toBe(true)
  })

  it('EDU 产品线分税正确：软件 13% / 服务 6%（taxCategory 配置，非产品码）', () => {
    const lines: QuoteLineResult[] = [
      { lineNo: 1, productCode: 'LMS', quantity: 50, unitPrice: 200, listPrice: 10000, subtotal: 10000, isGift: false, giftOriginalAmount: null, taxRate: null, taxAmount: null, source: 'cumulative', noPrice: false, taxCategory: 'software', costPrice: null, floorPrice: null, lineCost: null, marginRate: null },
      { lineNo: 2, productCode: 'SVC_IMPL', quantity: 10, unitPrice: 500, listPrice: 5000, subtotal: 5000, isGift: false, giftOriginalAmount: null, taxRate: null, taxAmount: null, source: 'manual', noPrice: false, taxCategory: 'service', costPrice: null, floorPrice: null, lineCost: null, marginRate: null },
    ]
    const t = computeQuoteTotals({ lines, discountRate: 0, softwareTaxRate: 0.13, serviceTaxRate: 0.06 })
    expect(t.softwareTaxAmount).toBe(1300)
    expect(t.serviceTaxAmount).toBe(300)
    expect(t.grandTotal).toBe(16600)
  })
})
