import { supabaseAdmin } from '@/lib/supabase'
import { getPublishedTaxRate } from '@/lib/configs/runtime'
import { isSchemaDriftError } from '@/lib/db-compat'
import {
  calculateQuoteTotals,
  formatTierRangeLabel,
  resolveProductUnitPrice,
  type PriceBookProduct,
  type ProductPriceTier,
} from '@/lib/pricing/engine'
import { calculateQuote } from '@/lib/pricing/quote-calculator'
import type { QuoteLineInput } from '@/lib/pricing/quote-builder'

type ProductStatus = 'active' | 'inactive' | 'discontinued'

type ProductRow = PriceBookProduct & {
  status: ProductStatus
  category_id?: string | null
  product_price_tiers?: ProductPriceTier[] | null
}

export interface RequestedQuoteItem {
  product_type?: 'sku' | 'custom'
  product_id?: string
  name?: string
  quantity: number
  unit_price?: number
  discount?: number
  sort_order?: number
}

export interface CalculatedQuoteItem {
  product_id: string | null
  product_type: 'sku' | 'custom'
  product_code: string | null
  name: string
  specification: string | null
  unit: string | null
  quantity: number
  unit_price: number
  discount: number
  line_total: number
  sort_order: number
  pricing_source: 'base' | 'tier' | 'manual'
  tier_range: string | null
}

export interface CalculatedQuoteDraft {
  items: CalculatedQuoteItem[]
  subtotal: number
  discountRate: number
  discountAmount: number
  taxRate: number
  taxAmount: number
  totalAmount: number
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export async function loadProductsForOrg(orgId: string, productIds?: string[]): Promise<ProductRow[]> {
  let query = supabaseAdmin
    .from('products')
    .select('*, product_price_tiers(*)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (productIds && productIds.length > 0) {
    query = query.in('id', productIds)
  }

  const { data, error } = await query
  if (error && !isSchemaDriftError(error)) {
    throw error
  }

  let resolvedData = data
  if (error && isSchemaDriftError(error)) {
    let legacyQuery = supabaseAdmin
      .from('products')
      .select('*')
      .order('created_at', { ascending: false })

    if (productIds && productIds.length > 0) {
      legacyQuery = legacyQuery.in('id', productIds)
    }

    const legacyResult = await legacyQuery
    if (legacyResult.error) {
      throw legacyResult.error
    }
    resolvedData = (legacyResult.data || []).map((row) => ({
      ...row,
      product_price_tiers: [],
      tier_pricing_enabled: false,
    }))
  }

  return ((resolvedData || []) as Array<ProductRow & {
    product_price_tiers?: Array<ProductPriceTier & { sort_order?: number | null }> | null
  }>).map((row) => ({
    ...row,
    product_price_tiers: (row.product_price_tiers || []).map((tier) => ({
      ...tier,
      qty_to: tier.qty_to ?? null,
      sort_order: tier.sort_order ?? 0,
    })),
  }))
}

export async function calculateQuoteDraft(
  orgId: string,
  requestedItems: RequestedQuoteItem[],
  discountRate: number = 0
): Promise<CalculatedQuoteDraft> {
  const productIds = requestedItems
    .filter((item) => item.product_type !== 'custom' && item.product_id)
    .map((item) => item.product_id as string)

  const products = await loadProductsForOrg(orgId, productIds)
  const productMap = new Map(products.map((product) => [product.id, product]))

  const calculatedItems: CalculatedQuoteItem[] = requestedItems.map((item, index) => {
    const quantity = item.quantity
    const discount = roundCurrency(item.discount ?? 0)
    const productType = item.product_type ?? 'sku'

    if (productType === 'custom') {
      const manualUnitPrice = roundCurrency(item.unit_price ?? 0)
      return {
        product_id: null,
        product_type: 'custom',
        product_code: null,
        name: item.name || `自定义项 ${index + 1}`,
        specification: null,
        unit: null,
        quantity,
        unit_price: manualUnitPrice,
        discount,
        line_total: roundCurrency(quantity * manualUnitPrice - discount),
        sort_order: item.sort_order ?? index,
        pricing_source: 'manual',
        tier_range: null,
      }
    }

    const product = item.product_id ? productMap.get(item.product_id) : null
    if (!product) {
      throw new Error(`SKU 不存在或无权限: ${item.product_id ?? 'unknown'}`)
    }
    if (product.status !== 'active') {
      throw new Error(`SKU 不可用于报价: ${product.name}`)
    }

    const pricing = resolveProductUnitPrice(product, quantity)
    return {
      product_id: product.id,
      product_type: 'sku',
      product_code: product.code,
      name: product.name,
      specification: product.specification ?? null,
      unit: product.unit ?? null,
      quantity,
      unit_price: pricing.unitPrice,
      discount,
      line_total: roundCurrency(quantity * pricing.unitPrice - discount),
      sort_order: item.sort_order ?? index,
      pricing_source: pricing.source,
      tier_range: formatTierRangeLabel(pricing.tier),
    }
  })

  const subtotal = calculatedItems.reduce((sum, item) => sum + item.line_total, 0)
  const taxRate = await getPublishedTaxRate(orgId)
  const totals = calculateQuoteTotals({
    subtotal,
    discountRate,
    taxRate,
  })

  return {
    items: calculatedItems,
    ...totals,
  }
}

// ────────────────────────────────────────────────────────────────
// F038/F044 ONES 结构化报价计算（server 权威口径）
// 输入：产品 + 版本/部署/授权/期限 + 账号数 → 读已发布多维价盘 → 累计计价
// 与客户端预览共用 lib/pricing/quote-calculator（M4 单一引擎）
// ────────────────────────────────────────────────────────────────
export interface OnesQuoteItem extends RequestedQuoteItem {
  version_code?: string
  deployment?: string
  auth_mode?: string
  term_months?: number | null
  discount_rate?: number
}

export async function calculateQuoteDraftOnes(
  orgId: string,
  items: OnesQuoteItem[],
  discountRate: number,
  options: { region?: string; softwareTaxRate?: number; serviceTaxRate?: number } = {}
): Promise<CalculatedQuoteDraft> {
  const productIds = items.map((i) => i.product_id).filter((v): v is string => !!v)
  const products = await loadProductsForOrg(orgId, productIds)
  const productById = new Map(products.map((p) => [p.id, p]))

  // F049：区域税率必须由调用方解析后传入（配置中心 regional_tax_rates 是唯一源）
  // 不设代码默认值：缺失即报错，防止海外/多税率场景静默用错税率
  if (options.softwareTaxRate == null || options.serviceTaxRate == null) {
    throw new Error('缺少区域税率配置（softwareTaxRate/serviceTaxRate），请在配置中心维护 regional_tax_rates 后重试')
  }
  const softwareTaxRate = options.softwareTaxRate
  const serviceTaxRate = options.serviceTaxRate
  const region = options.region ?? 'CN'

  // 读已发布多维价盘（每行 = 一档；按区域过滤，指定区域无价回退 CN）
  interface MatrixRow {
    product_id: string
    version_code: string
    deployment: string
    auth_mode: string
    term_months: number | null
    qty_from: number
    qty_to: number | null
    unit_price: number | null
    list_price: number | null
  }
  let matrixRows: MatrixRow[] = []
  for (const r of [region, 'CN']) {
    const { data, error } = await supabaseAdmin
      .from('price_matrix')
      .select('*')
      .eq('org_id', orgId)
      .eq('status', 'PUBLISHED')
      .eq('region', r)
    if (error) {
      throw error
    }
    if (data && data.length > 0) {
      matrixRows = (data || []) as MatrixRow[]
      break
    }
  }

  // 从产品目录 attributes 转义业务语义（不再按产品名/代码写死）：
  // attributes: { category, follows, quantityLinkedTo, taxCategory, version_codes }
  const attrsOf = (product: PriceBookProduct | undefined): Record<string, unknown> => {
    const raw = (product as { attributes?: unknown } | undefined)?.attributes
    return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  }
  const parseCategory = (v: unknown): QuoteLineInput['category'] =>
    v === 'FOLLOW_PRODUCT' || v === 'FOLLOW_APP' || v === 'FOLLOW_ECO' ? v : 'BASE'
  const parseStrArray = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  const parseStr = (v: unknown): string | undefined => typeof v === 'string' && v ? v : undefined

  const lines = items.map((item) => {
    const product = item.product_id ? productById.get(item.product_id) : undefined
    const attrs = attrsOf(product)
    const tiers = (matrixRows || [])
      .filter(
        (r) =>
          r.product_id === item.product_id &&
          r.version_code === item.version_code &&
          r.deployment === item.deployment &&
          r.auth_mode === item.auth_mode &&
          (item.term_months == null ? r.term_months == null : r.term_months === item.term_months)
      )
      .map((r) => ({ qty_from: r.qty_from, qty_to: r.qty_to, unit_price: r.unit_price, list_price: r.list_price }))

    return {
      productId: item.product_id ?? '',
      productCode: product?.code ?? item.name ?? '',
      category: parseCategory(attrs.category),
      follows: parseStrArray(attrs.follows),
      quantityLinkedTo: parseStr(attrs.quantityLinkedTo),
      taxCategory: attrs.taxCategory === 'service' ? ('service' as const) : ('software' as const),
      versionCode: item.version_code ?? '',
      deployment: item.deployment ?? '',
      authMode: item.auth_mode ?? '',
      termMonths: item.term_months ?? null,
      quantity: item.quantity,
      tiers,
      priceOverride: item.product_type === 'custom' ? item.unit_price : undefined,
      discountRate: item.discount_rate,
    }
  })

  const calculated = calculateQuote({
    lines,
    discountRate,
    softwareTaxRate,
    serviceTaxRate,
    currency: 'CNY',
  })

  if (!calculated.ok) {
    const messages = [
      ...calculated.issues.map((i) => i.message),
      ...(calculated.noPrice ? ['存在 10,000+ 无价档，需人工评审'] : []),
    ]
    throw new Error(`报价组合不合法：${messages.join('；')}`)
  }

  const productByCode = new Map(products.map((p) => [p.code, p]))
  const itemsOut: CalculatedQuoteItem[] = calculated.lines.map((line) => {
    const product = productByCode.get(line.productCode)
    return {
      product_id: product?.id ?? null,
      product_type: 'sku',
      product_code: line.productCode,
      name: product?.name ?? line.productCode,
      specification: product?.specification ?? null,
      unit: product?.unit ?? null,
      quantity: line.quantity,
      unit_price: line.unitPrice ?? 0,
      discount: line.discountAmount ?? 0,
      line_total: line.subtotal ?? 0,
      sort_order: line.lineNo - 1,
      pricing_source: line.source === 'manual' ? 'manual' : line.source === 'base' ? 'base' : 'tier',
      tier_range: null,
    }
  })

  return {
    items: itemsOut,
    subtotal: calculated.subtotal,
    discountRate,
    discountAmount: calculated.discountAmount,
    taxRate: calculated.taxAmount === 0 ? 0 : (calculated.softwareTaxAmount + calculated.serviceTaxAmount) / Math.max(calculated.subtotal - calculated.discountAmount, 1),
    taxAmount: calculated.taxAmount,
    totalAmount: calculated.grandTotal,
  }
}
