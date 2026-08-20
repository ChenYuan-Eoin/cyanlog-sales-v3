// REQ: F037/F038/F044/F045
// PURPOSE: 报价构建纯逻辑（选品组合校验 + 累计计价 + 分税 + 赠送 + 中文大写）
// 纯函数，不依赖 DB；阶段 1 标准报价闭环的核心计算层
import { resolveCumulativeTierPrice, type CumulativeTier } from './cumulative'

// ---------- 选品组合校验 ----------
export type ProductCategory = 'BASE' | 'FOLLOW_PRODUCT' | 'FOLLOW_APP' | 'FOLLOW_ECO'

export interface QuoteLineInput {
  productId: string
  productCode: string
  category: ProductCategory
  follows: string[]          // 跟随对象 product_code 列表
  versionCode: string
  deployment: string         // PUBLIC_CLOUD/PRIVATE/HA
  authMode: string           // SUB_YEAR/SUB_3YEAR/ONETIME
  termMonths: number | null
  quantity: number
  isGift?: boolean
  tiers?: CumulativeTier[]
  priceOverride?: number     // 服务/二开自定义价（可选）
  costPrice?: number         // F048 内部：产品成本单价（服务端从产品目录带入）
  floorPrice?: number        // F048 内部：产品底价（服务端从产品目录带入）
  discountRate?: number      // F050 行级折扣比例（0-1，可选；行折扣后再打整单折扣）
  taxCategory?: 'software' | 'service'  // 税目类别（由产品目录/行类型映射提供；缺省 software）
  quantityLinkedTo?: string  // 生态/跟随产品账号数必须等于的基座 product_code（由产品属性提供）
}

export interface CombinationIssue {
  code: string
  message: string
  line?: number
}

/**
 * 选品组合校验：
 *  1) 跟随类必须有基座（follows 命中）
 *  2) 搭售一致性：BASE+FOLLOW_PRODUCT+FOLLOW_APP ≥2 款时版本/部署/授权一致
 *  3) FOLLOW_ECO（WPS/X-mind）账号数必须等于其基座 Wiki 账号数
 *  4) 10,000+ 不自动出价（由计价层返回 no_price，此处提示）
 */
export function validateProductCombination(items: QuoteLineInput[], baseQuantities: Record<string, number> = {}): CombinationIssue[] {
  const issues: CombinationIssue[] = []
  const core = items.filter((it) => it.category !== 'FOLLOW_ECO')

  items.forEach((item, index) => {
    // 1) 跟随校验
    if (item.category !== 'BASE' && item.follows.length === 0) {
      issues.push({ code: 'FOLLOW_REQUIRED', message: `${item.productCode} 必须跟随基座产品`, line: index + 1 })
    }
    if (item.category !== 'BASE') {
      const hasBase = items.some((it) => it.category === 'BASE' && item.follows.includes(it.productCode))
      if (!hasBase) {
        issues.push({ code: 'BASE_MISSING', message: `${item.productCode} 缺少基座产品（跟随 ${item.follows.join('/')}）`, line: index + 1 })
      }
    }
    // 3) 账号数联动：quantityLinkedTo 声明的基座 product_code（如生态应用账号数=基座账号数）
    //    机制不依赖具体产品名；未声明联动则不校验（由产品属性配置决定）
    if (item.quantityLinkedTo) {
      const base = items.find((it) => it.category === 'BASE' && it.productCode === item.quantityLinkedTo)
      const baseQty = base ? base.quantity : baseQuantities[item.quantityLinkedTo]
      if (baseQty !== undefined && baseQty !== item.quantity) {
        issues.push({
          code: 'ECO_QTY_MISMATCH',
          message: `${item.productCode} 账号数(${item.quantity})必须等于 ${item.quantityLinkedTo} 账号数(${baseQty})`,
          line: index + 1,
        })
      }
    }
  })

  // 2) 搭售一致性（≥2 款核心组合）
  if (core.length >= 2) {
    const first = core[0]
    for (let i = 1; i < core.length; i += 1) {
      const cur = core[i]
      if (cur.versionCode !== first.versionCode) {
        issues.push({ code: 'VERSION_MISMATCH', message: `${cur.productCode} 版本(${cur.versionCode})与 ${first.productCode}(${first.versionCode})不一致`, line: i + 1 })
      }
      if (cur.deployment !== first.deployment) {
        issues.push({ code: 'DEPLOY_MISMATCH', message: `${cur.productCode} 部署(${cur.deployment})与 ${first.productCode}(${first.deployment})不一致`, line: i + 1 })
      }
      if (cur.authMode !== first.authMode) {
        issues.push({ code: 'AUTH_MISMATCH', message: `${cur.productCode} 授权(${cur.authMode})与 ${first.productCode}(${first.authMode})不一致`, line: i + 1 })
      }
    }
  }

  return issues
}

// ---------- 报价行与汇总 ----------
export interface QuoteLineResult {
  lineNo: number
  productCode: string
  name?: string
  quantity: number
  unitPrice: number | null
  listPrice: number | null
  subtotal: number | null
  isGift: boolean
  giftOriginalAmount: number | null
  taxRate: number | null
  taxAmount: number | null
  source: 'cumulative' | 'no_price' | 'manual' | 'base'
  noPrice: boolean
  taxCategory: 'software' | 'service'   // 税目类别（来自输入，不再按产品码判断）
  // F048 内部价与毛利（内部字段，客户输出永不出现）
  costPrice: number | null
  floorPrice: number | null
  lineCost: number | null
  marginRate: number | null
  discountAmount?: number    // F050 行级折扣金额（折后 subtotal 已扣除）
}

export interface QuoteTotalInput {
  lines: QuoteLineResult[]
  discountRate: number   // 0-1
  softwareTaxRate: number
  serviceTaxRate: number
}

export interface QuoteTotalResult {
  subtotal: number
  discountAmount: number
  taxable: number
  softwareTaxAmount: number
  serviceTaxAmount: number
  taxAmount: number
  grandTotal: number
  totalInWords: string
  // F048 内部毛利
  totalCost: number
  marginRate: number | null
}

export function buildQuoteLine(item: QuoteLineInput, index: number): QuoteLineResult {
  const priceOverride = item.priceOverride
  const manual = priceOverride !== undefined
  if (manual) {
    const gross = priceOverride * item.quantity
    const discountAmount = item.discountRate ? Math.round(gross * item.discountRate * 100) / 100 : 0
    const subtotal = Math.round((gross - discountAmount) * 100) / 100
    return {
      lineNo: index + 1,
      productCode: item.productCode,
      quantity: item.quantity,
      unitPrice: priceOverride,
      listPrice: null,
      subtotal,
      discountAmount: discountAmount > 0 ? discountAmount : undefined,
      isGift: !!item.isGift,
      giftOriginalAmount: item.isGift ? subtotal : null,
      taxRate: null, // 由汇总按 taxCategory 取
      taxAmount: null,
      source: 'manual',
      noPrice: false,
      taxCategory: item.taxCategory ?? 'software',
      costPrice: item.costPrice ?? null,
      floorPrice: item.floorPrice ?? null,
      lineCost: item.costPrice !== undefined && item.costPrice > 0 ? Math.round(item.costPrice * item.quantity * 100) / 100 : null,
      marginRate: item.costPrice !== undefined && item.costPrice > 0 && priceOverride > 0 ? (priceOverride - item.costPrice) / priceOverride : null,
    }
  }

  const resolved = resolveCumulativeTierPrice(item.tiers || [], item.quantity)
  const gross = resolved.total !== null ? resolved.total : 0
  const discountAmount = item.discountRate && gross > 0 ? Math.round(gross * item.discountRate * 100) / 100 : 0
  const subtotal = resolved.total !== null ? Math.round((gross - discountAmount) * 100) / 100 : null
  const line: QuoteLineResult = {
    lineNo: index + 1,
    productCode: item.productCode,
    quantity: item.quantity,
    unitPrice: resolved.unitPrice,
    listPrice: resolved.total,
    subtotal,
    discountAmount: discountAmount > 0 ? discountAmount : undefined,
    isGift: !!item.isGift,
    giftOriginalAmount: item.isGift && resolved.total !== null ? resolved.total : null,
    taxRate: null,
    taxAmount: null,
    source: resolved.source,
    noPrice: resolved.exceedsMax,
    taxCategory: item.taxCategory ?? 'software',
    costPrice: item.costPrice ?? null,
    floorPrice: item.floorPrice ?? null,
    lineCost: item.costPrice !== undefined && item.costPrice > 0 ? Math.round(item.costPrice * item.quantity * 100) / 100 : null,
    marginRate: item.costPrice !== undefined && item.costPrice > 0 && resolved.unitPrice !== null && resolved.unitPrice > 0 ? (resolved.unitPrice - item.costPrice) / resolved.unitPrice : null,
  }
  return line
}

export function computeQuoteTotals(input: QuoteTotalInput): QuoteTotalResult {
  const nonGift = input.lines.filter((l) => !l.isGift && l.subtotal !== null)
  const subtotal = nonGift.reduce((sum, l) => sum + (l.subtotal ?? 0), 0)
  const discountAmount = subtotal * input.discountRate
  const taxable = subtotal - discountAmount

  let softwareTaxAmount = 0
  let serviceTaxAmount = 0
  for (const line of nonGift) {
    if (line.subtotal === null) continue
    const lineNet = line.subtotal * (1 - input.discountRate)
    if ((line.taxCategory ?? 'software') === 'software') {
      softwareTaxAmount += lineNet * input.softwareTaxRate
    } else {
      serviceTaxAmount += lineNet * input.serviceTaxRate
    }
  }
  const round = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100
  softwareTaxAmount = round(softwareTaxAmount)
  serviceTaxAmount = round(serviceTaxAmount)
  const taxAmount = round(softwareTaxAmount + serviceTaxAmount)
  const grandTotal = round(taxable + taxAmount)

  const totalCost = round(input.lines.reduce((sum, l) => sum + (l.lineCost ?? 0), 0))
  const marginRate = totalCost > 0 && taxable > 0 ? round((taxable - totalCost) / taxable * 10000) / 10000 : null

  return {
    subtotal: round(subtotal),
    discountAmount: round(discountAmount),
    taxable: round(taxable),
    softwareTaxAmount,
    serviceTaxAmount,
    taxAmount,
    grandTotal,
    totalInWords: numberToChineseUpper(grandTotal),
    totalCost,
    marginRate,
  }
}

// ---------- 中文大写金额 ----------
const UPPER_DIGITS = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
const UPPER_UNITS = ['', '拾', '佰', '仟']
const UPPER_GROUPS = ['', '万', '亿', '兆']

function groupToChinese(n: number): string {
  if (n === 0) return '零'
  let result = ''
  let zeroPending = false
  let unitIndex = 0
  while (n > 0) {
    const digit = n % 10
    if (digit === 0) {
      if (result !== '' && !zeroPending) {
        result = '零' + result
        zeroPending = true
      }
    } else {
      result = UPPER_DIGITS[digit] + UPPER_UNITS[unitIndex] + result
      zeroPending = false
    }
    n = Math.floor(n / 10)
    unitIndex += 1
  }
  return result
}

export function numberToChineseUpper(value: number): string {
  if (!Number.isFinite(value) || value < 0) {
    return ''
  }
  const amount = Math.round((value + Number.EPSILON) * 100)
  const integerPart = Math.floor(amount / 100)
  const jiao = Math.floor((amount % 100) / 10)
  const fen = amount % 10

  if (integerPart === 0 && jiao === 0 && fen === 0) {
    return '零元整'
  }

  let integerText = ''
  if (integerPart > 0) {
    const groups: number[] = []
    let x = integerPart
    while (x > 0) {
      groups.push(x % 10000)
      x = Math.floor(x / 10000)
    }
    let result = ''
    let gapZero = false
    for (let i = groups.length - 1; i >= 0; i -= 1) {
      const g = groups[i]
      if (g === 0) {
        if (result !== '') {
          gapZero = true
        }
        continue
      }
      let text = groupToChinese(g) + UPPER_GROUPS[i]
      if (gapZero) {
        text = '零' + text
        gapZero = false
      } else if (result !== '' && g < 1000) {
        text = '零' + text
      }
      result += text
    }
    integerText = result + '元'
  }

  let decimalText = ''
  if (jiao === 0 && fen === 0) {
    decimalText = '整'
  } else {
    if (jiao > 0) {
      decimalText += UPPER_DIGITS[jiao] + '角'
    } else if (fen > 0 && integerPart > 0) {
      decimalText += '零'
    }
    if (fen > 0) {
      decimalText += UPPER_DIGITS[fen] + '分'
    }
  }
  return integerText + decimalText
}
