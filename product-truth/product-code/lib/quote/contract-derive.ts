// REQ: WP10 阶段4
// PURPOSE: 冻结版本 → 合同派生映射（纯函数，字段逐位一致契约）
// 原则：合同草稿金额/税/客户/明细必须与冻结版本逐位一致；版本漂移时拒绝派生
import type { QuoteVersionPayload } from './version-builder'

export interface DeriveContractInput {
  quote_no: string
  customer_name: string
  customer_contact: string | null
  currency: string
  version: QuoteVersionPayload
}

export interface DerivedContract {
  title: string
  party_b_name: string
  party_b_contact: string | null
  contract_amount: number
  tax_amount: number
  business_params: {
    quote_no: string
    currency: string
    discount_rate: number
    discount_amount: number
    tax_summary: unknown
    valid_until: string | null
    version_no: number
    line_items: Array<{
      product_code: string | null
      name: string | null
      version_code: string | null
      deployment: string | null
      auth_mode: string | null
      term_months: number | null
      quantity: number
      unit_price: number
      list_price: number | null
      line_total: number
      tax_rate: number | null
      is_gift: boolean
    }>
  }
}

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

/** 从冻结版本派生合同草稿数据（字段逐位一致，不做任何四舍五入改写） */
export function deriveContractFromVersion(input: DeriveContractInput): DerivedContract {
  const header = input.version.header
  const lineItems = input.version.items.map((it) => ({
    product_code: it.product_code,
    name: it.name,
    version_code: it.version_code,
    deployment: it.deployment,
    auth_mode: it.auth_mode,
    term_months: it.term_months,
    quantity: it.quantity,
    unit_price: it.unit_price,
    list_price: it.list_price,
    line_total: it.line_total,
    tax_rate: it.tax_rate,
    is_gift: it.is_gift,
  }))

  return {
    title: `${input.customer_name} 采购合同（源自报价 ${input.quote_no}）`,
    party_b_name: input.customer_name,
    party_b_contact: input.customer_contact,
    contract_amount: header.total_amount,
    tax_amount: header.tax_amount,
    business_params: {
      quote_no: input.quote_no,
      currency: input.currency,
      discount_rate: header.discount_rate,
      discount_amount: header.discount_amount,
      tax_summary: header.tax_summary,
      valid_until: header.valid_until,
      version_no: input.version.version_no,
      line_items: lineItems,
    },
  }
}

/** 防漂移校验：报价当前金额与冻结版本金额必须一致（容差 0.01） */
export function assertVersionMatchesQuote(versionTotal: number, quoteTotal: number): string | null {
  if (!Number.isFinite(versionTotal) || !Number.isFinite(quoteTotal)) {
    return '版本或报价金额无效'
  }
  if (Math.abs(round2(versionTotal) - round2(quoteTotal)) > 0.01) {
    return `版本金额(${round2(versionTotal)})与报价金额(${round2(quoteTotal)})不一致`
  }
  return null
}
