// REQ: F029/F030/F034
// PURPOSE: 标准报价单导出数据构建（白名单脱敏 + 有效性 + 水印信息）
// 原则：内部字段永不进入输出流；导出只读冻结版本，禁止读实时可变数据
import { pickWhitelisted } from './field-whitelist'

export interface QuoteExportInput {
  quoteNo: string
  customerName: string
  customerContact?: string | null
  validUntil?: string | null
  currency?: string | null
  subtotal?: number | null
  discountRate?: number | null
  discountAmount?: number | null
  taxAmount?: number | null
  totalAmount?: number | null
  totalInWords?: string | null
  taxSummary?: unknown
  items: Array<Record<string, unknown>>
  notes?: string | null
}

export interface QuoteExportResult {
  ok: boolean
  message: string
  data: {
    quote_no: string
    customer_name: string
    valid_until: string | null
    currency: string
    subtotal: number
    discount_rate: number
    discount_amount: number
    tax_amount: number
    total_amount: number
    total_in_words: string
    tax_summary: unknown
    items: unknown[]
    watermark: string
    generated_at: string
  } | null
}

const ITEM_FIELDS = ['name', 'version_code', 'deployment', 'auth_mode', 'term_months', 'quantity', 'unit_price', 'list_price', 'line_total', 'is_gift', 'gift_original_amount', 'tier_range']

/** 构建标准单导出数据：白名单过滤 + 水印 + 生成时间；隐藏字段（成本/毛利/审批）物理剔除 */
export function buildQuoteExportData(input: QuoteExportInput): QuoteExportResult {
  const items = input.items.map((item) => pickWhitelisted(item, ITEM_FIELDS) as Record<string, unknown>)

  const data = {
    quote_no: input.quoteNo,
    customer_name: input.customerName,
    valid_until: input.validUntil ?? null,
    currency: input.currency ?? 'CNY',
    subtotal: input.subtotal ?? 0,
    discount_rate: input.discountRate ?? 0,
    discount_amount: input.discountAmount ?? 0,
    tax_amount: input.taxAmount ?? 0,
    total_amount: input.totalAmount ?? 0,
    total_in_words: input.totalInWords ?? '',
    tax_summary: input.taxSummary ?? null,
    items,
    watermark: '内部审批信息已脱敏，此报价自生成日起 15 日内有效',
    generated_at: new Date().toISOString(),
  }

  // 顶层用 denylist 兜底剔除内部字段；items 已按 ITEM_FIELDS 白名单预过滤
  const sanitized = pickWhitelisted(data, [], 'denylist') as typeof data
  sanitized.items = items
  return { ok: true, message: 'ok', data: sanitized }
}
