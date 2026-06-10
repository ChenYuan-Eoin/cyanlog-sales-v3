export interface ProductPriceTier {
  id?: string
  qty_from: number
  qty_to: number | null
  unit_price: number
  sort_order?: number
}

export interface PriceBookProduct {
  id: string
  code: string
  name: string
  specification?: string | null
  unit?: string | null
  base_price: number
  min_price?: number | null
  tier_pricing_enabled?: boolean | null
  product_price_tiers?: ProductPriceTier[] | null
}

export interface PriceResolution {
  unitPrice: number
  source: 'base' | 'tier'
  tier: ProductPriceTier | null
}

export interface QuoteTotalsInput {
  subtotal: number
  discountRate?: number
  taxRate?: number
}

export interface QuoteTotals {
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

export function sortPriceTiers(tiers: ProductPriceTier[]): ProductPriceTier[] {
  return [...tiers].sort((left, right) => {
    if ((left.sort_order ?? 0) !== (right.sort_order ?? 0)) {
      return (left.sort_order ?? 0) - (right.sort_order ?? 0)
    }
    return left.qty_from - right.qty_from
  })
}

export function validatePriceTiers(tiers: ProductPriceTier[], minPrice: number = 0): string | null {
  const sorted = sortPriceTiers(tiers)

  for (let index = 0; index < sorted.length; index += 1) {
    const tier = sorted[index]
    if (!Number.isInteger(tier.qty_from) || tier.qty_from < 1) {
      return '阶梯价起始数量必须为大于等于 1 的整数'
    }
    if (tier.qty_to !== null && (!Number.isInteger(tier.qty_to) || tier.qty_to <= tier.qty_from)) {
      return '阶梯价结束数量必须大于起始数量'
    }
    if (tier.unit_price < 0) {
      return '阶梯价单价不能为负数'
    }
    if (tier.unit_price < minPrice) {
      return '阶梯价单价不能低于最低保护价'
    }

    const previous = sorted[index - 1]
    if (previous) {
      if (previous.qty_to === null) {
        return '无上限阶梯价必须是最后一档'
      }
      if (tier.qty_from <= previous.qty_to) {
        return '阶梯价区间不能重叠'
      }
    }
  }

  return null
}

export function resolveProductUnitPrice(product: PriceBookProduct, quantity: number): PriceResolution {
  const tiers = sortPriceTiers(product.product_price_tiers || [])
  if (product.tier_pricing_enabled) {
    const matchedTier = tiers.find((tier) => (
      tier.qty_from <= quantity
      && (tier.qty_to === null || quantity <= tier.qty_to)
    ))

    if (matchedTier) {
      return {
        unitPrice: roundCurrency(Number(matchedTier.unit_price || 0)),
        source: 'tier',
        tier: matchedTier,
      }
    }
  }

  return {
    unitPrice: roundCurrency(Number(product.base_price || 0)),
    source: 'base',
    tier: null,
  }
}

export function formatTierRangeLabel(tier: ProductPriceTier | null): string | null {
  if (!tier) {
    return null
  }
  return tier.qty_to === null
    ? `${tier.qty_from}+`
    : `${tier.qty_from}-${tier.qty_to}`
}

export function calculateQuoteTotals(input: QuoteTotalsInput): QuoteTotals {
  const subtotal = roundCurrency(input.subtotal)
  const discountRate = roundCurrency(input.discountRate ?? 0)
  const taxRate = input.taxRate ?? 0
  const discountAmount = roundCurrency(subtotal * (discountRate / 100))
  const taxableBase = roundCurrency(subtotal - discountAmount)
  const taxAmount = roundCurrency(taxableBase * taxRate)
  const totalAmount = roundCurrency(taxableBase + taxAmount)

  return {
    subtotal,
    discountRate,
    discountAmount,
    taxRate,
    taxAmount,
    totalAmount,
  }
}
