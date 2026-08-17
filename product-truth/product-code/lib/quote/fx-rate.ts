// REQ: F042（业务参数 FX_SOURCE=BOC）
// PURPOSE: 中行官方外汇牌价接入。中国银行无公开开发者实时汇率 API，
// 官方权威免费源为牌价页 https://www.boc.cn/sourcedb/whpj/（HTML 表格）。
// 本模块服务端抓取 + 内存缓存 + 超时；失败返回 null，绝不伪造数据。
// 牌价表口径：每 100 单位外币兑人民币（如 美元 678.78 = 100 USD 兑 678.78 CNY）。

export type BocRateType = 'spotBuy' | 'cashBuy' | 'spotSell' | 'cashSell' | 'middle'

export interface BocRate {
  currency: string // 货币名称，如 美元
  spotBuy: number | null // 现汇买入价
  cashBuy: number | null // 现钞买入价
  spotSell: number | null // 现汇卖出价
  cashSell: number | null // 现钞卖出价
  middle: number | null // 中行折算价
  publishedAt: string | null // 发布时间 yyyy/MM/dd HH:mm:ss
}

export function parseBocRateType(value: string | null | undefined): BocRateType {
  return value === 'spotSell' || value === 'spotBuy' || value === 'cashSell' || value === 'cashBuy' ? value : 'middle'
}

export const BOC_RATES_URL = 'https://www.boc.cn/sourcedb/whpj/'
export const BOC_CACHE_TTL_MS = 15 * 60 * 1000
export const BOC_FETCH_TIMEOUT_MS = 10_000

const BOC_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

interface CacheEntry {
  fetchedAt: number
  rates: BocRate[]
}

let cache: CacheEntry | null = null

function stripTags(cell: string): string {
  return cell.replace(/<[^>]*>/g, '').trim()
}

function toNumberOrNull(value: string): number | null {
  if (!value) {
    return null
  }
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** 解析中行牌价页 HTML（tr data-currency='货币名' + 8 个 td） */
export function parseBocRatesHtml(html: string): BocRate[] {
  const rows = html.match(/<tr[^>]*data-currency='([^']+)'[^>]*>[\s\S]*?<\/tr>/g) || []
  const rates: BocRate[] = []

  for (const row of rows) {
    const currencyMatch = row.match(/data-currency='([^']+)'/)
    if (!currencyMatch) {
      continue
    }
    const currency = currencyMatch[1].trim()
    const cells = (row.match(/<td[^>]*>[\s\S]*?<\/td>/g) || [])
      .slice(0, 7)
      .map(stripTags)

    // 期望：[货币名, 现汇买入, 现钞买入, 现汇卖出, 现钞卖出, 中行折算, 发布时间]
    if (cells.length < 7) {
      continue
    }
    const [name, ...values] = cells
    if (name !== currency) {
      continue
    }
    const rate: BocRate = {
      currency,
      spotBuy: toNumberOrNull(values[0]),
      cashBuy: toNumberOrNull(values[1]),
      spotSell: toNumberOrNull(values[2]),
      cashSell: toNumberOrNull(values[3]),
      middle: toNumberOrNull(values[4]),
      publishedAt: values[5] || null,
    }
    rates.push(rate)
  }
  return rates
}

/** 抓取中行牌价页并解析（服务端专用；超时抛错） */
export async function fetchBocRates(opts: { timeoutMs?: number } = {}): Promise<BocRate[]> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? BOC_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(BOC_RATES_URL, {
      headers: { 'User-Agent': BOC_USER_AGENT },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!res.ok) {
      throw new Error(`BOC rates HTTP ${res.status}`)
    }
    const html = await res.text()
    const rates = parseBocRatesHtml(html)
    if (rates.length === 0) {
      throw new Error('BOC rates page parsed 0 rows')
    }
    return rates
  } finally {
    clearTimeout(timer)
  }
}

/** 带内存缓存的牌价读取（TTL 15 分钟） */
export async function getBocRatesCached(opts: { force?: boolean } = {}): Promise<BocRate[]> {
  if (!opts.force && cache && Date.now() - cache.fetchedAt < BOC_CACHE_TTL_MS) {
    return cache.rates
  }
  const rates = await fetchBocRates()
  cache = { fetchedAt: Date.now(), rates }
  return rates
}

export interface QuoteFxRate {
  currency: string
  rateType: BocRateType
  ratePer100: number
  ratePerUnit: number // 1 单位外币 = ? CNY
  publishedAt: string | null
  source: 'BOC'
}

/** 取指定币种牌价（默认美元、中行折算价口径）；失败返回 null，不抛错 */
export async function getQuoteFxRate(
  currency = '美元',
  rateType: BocRateType = 'middle'
): Promise<QuoteFxRate | null> {
  try {
    const rates = await getBocRatesCached()
    const row = rates.find((r) => r.currency === currency)
    const value = row ? row[rateType] : null
    if (!row || typeof value !== 'number' || value <= 0) {
      return null
    }
    return {
      currency: row.currency,
      rateType,
      ratePer100: value,
      ratePerUnit: value / 100,
      publishedAt: row.publishedAt,
      source: 'BOC',
    }
  } catch (error) {
    console.error('[F042] getQuoteFxRate failed:', error)
    return null
  }
}

/** 测试用：重置内存缓存 */
export function resetBocRatesCacheForTest(): void {
  cache = null
}
