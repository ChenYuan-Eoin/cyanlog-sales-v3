// REQ: F032（FX_SOURCE=BOC）
// PURPOSE: 中行官方牌价抓取/解析/缓存测试（网络测试用 mock，CI 离线可跑）
import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  parseBocRatesHtml,
  parseBocRateType,
  fetchBocRates,
  getBocRatesCached,
  getQuoteFxRate,
  resetBocRatesCacheForTest,
  BOC_RATES_URL,
} from './fx-rate'

const SAMPLE_HTML = `
<table id="priceTable">
  <tr data-currency='美元'>
    <td>美元</td>
    <td>673.07</td>
    <td>673.07</td>
    <td>675.9</td>
    <td>675.9</td>
    <td>678.78</td>
    <td class="pjrq">2026/08/14 18:30:19</td>
    <td>18:30:19</td>
  </tr>
  <tr data-currency='欧元'>
    <td>欧元</td>
    <td>776.29</td>
    <td>776.29</td>
    <td>781.98</td>
    <td>781.98</td>
    <td>780.17</td>
    <td class="pjrq">2026/08/14 18:30:19</td>
    <td>18:30:19</td>
  </tr>
  <tr data-currency='新台币'>
    <td>新台币</td>
    <td></td>
    <td>20.19</td>
    <td></td>
    <td>22.12</td>
    <td>21</td>
    <td class="pjrq">2026/08/14 18:30:19</td>
    <td>18:30:19</td>
  </tr>
</table>
`

function mockFetchOnce(html: string, ok = true, status = 200): ReturnType<typeof vi.fn> {
  const fn = vi.fn().mockResolvedValue({
    ok,
    status,
    text: async () => html,
  } as Response)
  vi.stubGlobal('fetch', fn)
  return fn
}

beforeEach(() => {
  resetBocRatesCacheForTest()
})

describe('parseBocRateType', () => {
  it('合法口径透传，非法/空默认 middle', () => {
    expect(parseBocRateType('spotSell')).toBe('spotSell')
    expect(parseBocRateType('spotBuy')).toBe('spotBuy')
    expect(parseBocRateType('cashSell')).toBe('cashSell')
    expect(parseBocRateType('cashBuy')).toBe('cashBuy')
    expect(parseBocRateType('middle')).toBe('middle')
    expect(parseBocRateType('whatever')).toBe('middle')
    expect(parseBocRateType(null)).toBe('middle')
    expect(parseBocRateType(undefined)).toBe('middle')
  })
})

describe('parseBocRatesHtml', () => {
  it('解析美元/欧元/新台币，折算价与空单元格正确', () => {
    const rates = parseBocRatesHtml(SAMPLE_HTML)
    expect(rates).toHaveLength(3)

    const usd = rates.find((r) => r.currency === '美元')!
    expect(usd.spotBuy).toBe(673.07)
    expect(usd.spotSell).toBe(675.9)
    expect(usd.middle).toBe(678.78)
    expect(usd.publishedAt).toBe('2026/08/14 18:30:19')

    const twd = rates.find((r) => r.currency === '新台币')!
    expect(twd.spotBuy).toBeNull()
    expect(twd.cashBuy).toBe(20.19)
  })

  it('无牌价表格时返回空数组', () => {
    expect(parseBocRatesHtml('<html><body>维护中</body></html>')).toEqual([])
  })
})

describe('fetchBocRates', () => {
  it('成功抓取并解析', async () => {
    const fn = mockFetchOnce(SAMPLE_HTML)
    const rates = await fetchBocRates()
    expect(fn).toHaveBeenCalledWith(
      BOC_RATES_URL,
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
    expect(rates).toHaveLength(3)
  })

  it('非 200 抛错', async () => {
    mockFetchOnce('', false, 503)
    await expect(fetchBocRates()).rejects.toThrow('HTTP 503')
  })

  it('超时中止请求', async () => {
    const fn = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const err = new Error('aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    vi.stubGlobal('fetch', fn)
    await expect(fetchBocRates({ timeoutMs: 1 })).rejects.toThrow('aborted')
  })
})

describe('getBocRatesCached / getQuoteFxRate', () => {
  it('缓存生效：TTL 内只抓一次', async () => {
    const fn = mockFetchOnce(SAMPLE_HTML)
    const a = await getBocRatesCached()
    const b = await getBocRatesCached()
    expect(a).toHaveLength(3)
    expect(b).toBe(a)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('getQuoteFxRate 默认美元中行折算价，ratePerUnit=折算价/100', async () => {
    mockFetchOnce(SAMPLE_HTML)
    const fx = await getQuoteFxRate()
    expect(fx).not.toBeNull()
    expect(fx!.currency).toBe('美元')
    expect(fx!.rateType).toBe('middle')
    expect(fx!.ratePer100).toBe(678.78)
    expect(fx!.ratePerUnit).toBeCloseTo(6.7878, 4)
    expect(fx!.source).toBe('BOC')
  })

  it('币种不存在时返回 null，不抛错', async () => {
    mockFetchOnce(SAMPLE_HTML)
    const fx = await getQuoteFxRate('日元', 'middle')
    expect(fx).toBeNull()
  })

  it('抓取失败返回 null（不伪造数据）', async () => {
    mockFetchOnce('', false, 500)
    const fx = await getQuoteFxRate()
    expect(fx).toBeNull()
  })
})
