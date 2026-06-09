import type { Quote, QuoteItem } from '@/types'

type QuoteLike = Partial<Quote> & Record<string, unknown>
type QuoteItemLike = Partial<QuoteItem> & Record<string, unknown>

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function toNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function toStringOrFallback(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

function round(value: number, precision: number): number {
  const factor = 10 ** precision
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function isMissing(value: unknown): boolean {
  return value === undefined || value === null || value === ''
}

function pickDefined<T extends Record<string, unknown>>(record: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(record).filter(([, value]) => value !== undefined)
  ) as Partial<T>
}

export function normalizeQuoteItem(item: QuoteItemLike): QuoteItem {
  return {
    id: toStringOrFallback(item.id, ''),
    quote_id: toStringOrFallback(item.quote_id, ''),
    product_id: toNullableString(item.product_id),
    product_type: toStringOrFallback(item.product_type, 'sku'),
    product_code: toNullableString(item.product_code),
    name: toStringOrFallback(item.name, '未命名项目'),
    specification: toNullableString(item.specification),
    unit: toNullableString(item.unit),
    quantity: toNumber(item.quantity),
    unit_price: toNumber(item.unit_price),
    discount: toNumber(item.discount),
    line_total: toNumber(item.line_total),
    sort_order: toNumber(item.sort_order),
    pricing_source: item.pricing_source === 'tier' || item.pricing_source === 'manual' || item.pricing_source === 'base'
      ? item.pricing_source
      : undefined,
    tier_range: toNullableString(item.tier_range),
    created_at: toNullableString(item.created_at) ?? undefined,
  }
}

export function normalizeQuote(quote: QuoteLike, orgId: string, items?: QuoteItemLike[] | null): Quote {
  const rawItems = items ?? (Array.isArray(quote.quote_items) ? (quote.quote_items as QuoteItemLike[]) : undefined)
  const normalizedItems = rawItems
    ? rawItems.map((item) => normalizeQuoteItem(item)).sort((left, right) => (left.sort_order || 0) - (right.sort_order || 0))
    : undefined
  const subtotal = toNumber(quote.subtotal)
  const discountAmount = toNumber(quote.discount_amount)
  const taxAmount = toNumber(quote.tax_amount)
  const taxableBase = Math.max(subtotal - discountAmount, 0)
  const discountRate = isMissing(quote.discount_rate)
    ? (subtotal > 0 ? round((discountAmount / subtotal) * 100, 2) : 0)
    : toNumber(quote.discount_rate)
  const taxRate = isMissing(quote.tax_rate)
    ? (taxableBase > 0 ? round(taxAmount / taxableBase, 4) : 0)
    : toNumber(quote.tax_rate)

  return {
    id: toStringOrFallback(quote.id, ''),
    quote_no: toStringOrFallback(quote.quote_no, ''),
    org_id: toNullableString(quote.org_id) ?? orgId,
    customer_name: toStringOrFallback(quote.customer_name, ''),
    customer_contact: toNullableString(quote.customer_contact),
    subtotal,
    discount_rate: discountRate,
    tax_amount: taxAmount,
    tax_rate: taxRate,
    discount_amount: discountAmount,
    total_amount: toNumber(quote.total_amount),
    status: toStringOrFallback(quote.status, 'DRAFT') as Quote['status'],
    valid_until: toNullableString(quote.valid_until),
    notes: toNullableString(quote.notes),
    created_by: toNullableString(quote.created_by),
    created_at: toStringOrFallback(quote.created_at, new Date().toISOString()),
    updated_at: toStringOrFallback(
      quote.updated_at,
      toStringOrFallback(quote.created_at, new Date().toISOString())
    ),
    quote_items: normalizedItems,
  }
}

export function buildLegacyQuoteInsertPayload(input: {
  id: string
  quote_no: string
  customer_name: string
  customer_contact?: string | null
  subtotal: number
  discount_amount: number
  tax_amount: number
  total_amount: number
  status: string
  valid_until?: string
  created_by: string
}) {
  return pickDefined({
    id: input.id,
    quote_no: input.quote_no,
    customer_name: input.customer_name,
    customer_contact: input.customer_contact ?? null,
    subtotal: input.subtotal,
    discount_amount: input.discount_amount,
    tax_amount: input.tax_amount,
    total_amount: input.total_amount,
    status: input.status,
    valid_until: input.valid_until,
    created_by: input.created_by,
  })
}

export function buildLegacyQuoteUpdatePayload(updateData: Record<string, unknown>) {
  return pickDefined({
    customer_name: updateData.customer_name,
    customer_contact: updateData.customer_contact,
    subtotal: updateData.subtotal,
    tax_amount: updateData.tax_amount,
    discount_amount: updateData.discount_amount,
    total_amount: updateData.total_amount,
    valid_until: updateData.valid_until,
    status: updateData.status,
  })
}

export function buildLegacyQuoteItemInsertPayload(item: {
  id: string
  quote_id: string
  product_type: string
  name: string
  quantity: number
  unit_price: number
  discount: number
  line_total: number
  sort_order: number
}) {
  return {
    id: item.id,
    quote_id: item.quote_id,
    product_type: item.product_type,
    name: item.name,
    quantity: item.quantity,
    unit_price: item.unit_price,
    discount: item.discount,
    line_total: item.line_total,
    sort_order: item.sort_order,
  }
}
