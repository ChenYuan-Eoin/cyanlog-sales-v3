// REQ: F038/F044
// PURPOSE: 多维价盘累计阶梯计价（ONES 阶梯报价口径）
// 累计刊例价 = 上档累计 + 本档区间单账号价 × 档内数量
// 10,000+ 无价档 → 不自动出价（请联系我们）
// 纯函数，不依赖 DB；与 price-import 的导入校验共用同一数学口径

export interface CumulativeTier {
  qty_from: number
  qty_to: number | null
  unit_price: number | null
  list_price: number | null
}

export interface CumulativeResolution {
  total: number | null
  unitPrice: number | null
  matchedTier: CumulativeTier | null
  source: 'cumulative' | 'no_price' | 'base'
  exceedsMax: boolean
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function sortCumulativeTiers(tiers: CumulativeTier[]): CumulativeTier[] {
  return [...tiers].sort((a, b) => a.qty_from - b.qty_from)
}

/**
 * 按累计口径计算 N 账号的刊例总额。
 *  - 命中档内有价：total = 上档累计(0 起步) + 本档区间单账号价 × (数量 - 档下限 + 1)
 *  - 数量超过最后一档上限或落入无价档：total = null（10,000+ 请联系我们）
 *  - 无阶梯：按 basePrice × 数量
 */
export function resolveCumulativeTierPrice(
  tiers: CumulativeTier[],
  quantity: number,
  basePrice = 0
): CumulativeResolution {
  if (!Number.isFinite(quantity) || quantity < 1) {
    return { total: null, unitPrice: null, matchedTier: null, source: 'base', exceedsMax: false }
  }
  const sorted = sortCumulativeTiers(tiers)
  if (sorted.length === 0) {
    return { total: roundCurrency(basePrice * quantity), unitPrice: roundCurrency(basePrice), matchedTier: null, source: 'base', exceedsMax: false }
  }

  const last = sorted[sorted.length - 1]
  if (last.qty_to !== null && quantity > last.qty_to) {
    return { total: null, unitPrice: null, matchedTier: last, source: 'no_price', exceedsMax: true }
  }

  for (let index = 0; index < sorted.length; index += 1) {
    const tier = sorted[index]
    if (quantity < tier.qty_from) {
      continue
    }
    if (tier.qty_to !== null && quantity > tier.qty_to) {
      continue
    }
    if (tier.unit_price === null || tier.list_price === null) {
      return { total: null, unitPrice: null, matchedTier: tier, source: 'no_price', exceedsMax: true }
    }
    const prevList = index === 0 ? 0 : Number(sorted[index - 1].list_price ?? 0)
    const count = quantity - tier.qty_from + 1
    const total = prevList + Number(tier.unit_price) * count
    return {
      total: roundCurrency(total),
      unitPrice: roundCurrency(total / quantity),
      matchedTier: tier,
      source: 'cumulative',
      exceedsMax: false,
    }
  }

  return { total: null, unitPrice: null, matchedTier: null, source: 'no_price', exceedsMax: true }
}
