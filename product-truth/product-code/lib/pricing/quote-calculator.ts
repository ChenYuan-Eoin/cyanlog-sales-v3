// REQ: F027/F028/F034/F035
// PURPOSE: 报价计算器（整链纯函数）：组合校验 → 行计价 → 分税/赠送 → 大写
// 供报价创建/预览/冻结共用同一口径（M4 单一算价引擎）
import {
  validateProductCombination,
  buildQuoteLine,
  computeQuoteTotals,
  type QuoteLineInput,
  type QuoteLineResult,
  type CombinationIssue,
} from './quote-builder'

export interface QuoteCalculateInput {
  lines: QuoteLineInput[]
  discountRate: number
  softwareTaxRate: number
  serviceTaxRate: number
  currency?: string
  exchangeRate?: number
  validDays?: number
}

export interface QuoteCalculateResult {
  ok: boolean
  issues: CombinationIssue[]
  lines: QuoteLineResult[]
  subtotal: number
  discountAmount: number
  softwareTaxAmount: number
  serviceTaxAmount: number
  taxAmount: number
  grandTotal: number
  totalInWords: string
  currency: string
  exchangeRate: number | null
  noPrice: boolean
}

export function calculateQuote(input: QuoteCalculateInput): QuoteCalculateResult {
  const issues = validateProductCombination(input.lines)
  const lines = input.lines.map((item, index) => buildQuoteLine(item, index))
  const noPrice = lines.some((l) => l.noPrice)

  if (issues.length > 0 || noPrice) {
    return {
      ok: false,
      issues,
      lines,
      subtotal: 0,
      discountAmount: 0,
      softwareTaxAmount: 0,
      serviceTaxAmount: 0,
      taxAmount: 0,
      grandTotal: 0,
      totalInWords: '',
      currency: input.currency ?? 'CNY',
      exchangeRate: input.exchangeRate ?? null,
      noPrice,
    }
  }

  const totals = computeQuoteTotals({
    lines,
    discountRate: input.discountRate,
    softwareTaxRate: input.softwareTaxRate,
    serviceTaxRate: input.serviceTaxRate,
  })

  return {
    ok: true,
    issues: [],
    lines,
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    softwareTaxAmount: totals.softwareTaxAmount,
    serviceTaxAmount: totals.serviceTaxAmount,
    taxAmount: totals.taxAmount,
    grandTotal: totals.grandTotal,
    totalInWords: totals.totalInWords,
    currency: input.currency ?? 'CNY',
    exchangeRate: input.exchangeRate ?? null,
    noPrice: false,
  }
}
