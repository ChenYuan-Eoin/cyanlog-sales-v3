// REQ: F044
// PURPOSE: 冻结报价版本 payload 构建（结构化 header+items = 合同源数据）
import { quoteVersionChecksum } from './version-checksum'

export interface QuoteVersionHeader {
  quote_no: string
  customer_name: string
  customer_contact: string | null
  currency: string
  exchange_rate: number | null
  discount_rate: number
  subtotal: number
  discount_amount: number
  tax_amount: number
  total_amount: number
  tax_summary: unknown
  valid_until: string | null
  notes: string | null
}

export interface QuoteVersionItem {
  product_code: string | null
  name: string | null
  version_code: string | null
  deployment: string | null
  auth_mode: string | null
  term_months: number | null
  quantity: number
  unit_price: number
  list_price: number | null
  discount: number | null
  line_total: number
  tax_rate: number | null
  tax_amount: number | null
  is_gift: boolean
  gift_original_amount: number | null
  maintenance_months: number | null
  version_from: string | null
  version_to: string | null
  pricing_source: string | null
  tier_range: string | null
}

export interface QuoteVersionPayload {
  quote_no: string
  version_no: number
  header: QuoteVersionHeader
  items: QuoteVersionItem[]
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0))
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const bool = (v: unknown): boolean => v === true

/** 从现有 quotes/quote_items 行构建结构化版本 payload（字段缺失时容错为 null/0） */
export function buildQuoteVersionPayload(
  quote: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
  versionNo: number
): QuoteVersionPayload {
  return {
    quote_no: str(quote.quote_no) ?? '',
    version_no: versionNo,
    header: {
      quote_no: str(quote.quote_no) ?? '',
      customer_name: str(quote.customer_name) ?? '',
      customer_contact: str(quote.customer_contact),
      currency: str(quote.currency) ?? 'CNY',
      exchange_rate: typeof quote.exchange_rate === 'number' ? quote.exchange_rate : null,
      discount_rate: num(quote.discount_rate),
      subtotal: num(quote.subtotal),
      discount_amount: num(quote.discount_amount),
      tax_amount: num(quote.tax_amount),
      total_amount: num(quote.total_amount),
      tax_summary: quote.tax_summary ?? null,
      valid_until: str(quote.valid_until),
      notes: str(quote.notes),
    },
    items: items.map((item) => ({
      product_code: str(item.product_code),
      name: str(item.name),
      version_code: str(item.version_code),
      deployment: str(item.deployment),
      auth_mode: str(item.auth_mode),
      term_months: typeof item.term_months === 'number' ? item.term_months : null,
      quantity: num(item.quantity),
      unit_price: num(item.unit_price),
      list_price: typeof item.list_price === 'number' ? item.list_price : null,
      discount: typeof item.discount === 'number' ? item.discount : null,
      line_total: num(item.line_total),
      tax_rate: typeof item.tax_rate === 'number' ? item.tax_rate : null,
      tax_amount: typeof item.tax_amount === 'number' ? item.tax_amount : null,
      is_gift: bool(item.is_gift),
      gift_original_amount: typeof item.gift_original_amount === 'number' ? item.gift_original_amount : null,
      maintenance_months: typeof item.maintenance_months === 'number' ? item.maintenance_months : null,
      version_from: str(item.version_from),
      version_to: str(item.version_to),
      pricing_source: str(item.pricing_source),
      tier_range: str(item.tier_range),
    })),
  }
}

/** 版本 checksum（供中间快照逐位一致校验） */
export function checksumOfVersion(payload: QuoteVersionPayload): string {
  return quoteVersionChecksum(payload)
}
