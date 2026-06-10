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
