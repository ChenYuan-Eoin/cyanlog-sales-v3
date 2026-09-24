import { afterEach, describe, expect, it, vi } from 'vitest'
import { lookupSfOrder, sfCall } from './sf-client'
import type { ShippingRuntimeConfig } from './runtime-config'

const config: ShippingRuntimeConfig = {
  orgId: 'org-fixture', connectionId: 'connection-fixture', environment: 'production',
  partnerId: 'p'.repeat(12), checkWord: 'c'.repeat(32), services: [],
  billingAccountId: 'account-fixture', billingAccount: 'a'.repeat(12), billingAccountTail: '1234',
  senderProfileId: 'sender-fixture',
  sender: { name: '测试寄件人', phone: '13800000000', province: '广东省', city: '深圳市', county: '南山区', address: '测试路1号' },
  connectionKey: 'k'.repeat(64), snapshot: {}
}
const orderResponse = (orderId: string) => new Response(JSON.stringify({
  apiResultCode: 'A1000',
  apiResultData: JSON.stringify({ success: true, msgData: { orderId, waybillNoInfoList: [{ waybillType: 1, waybillNo: 'SF1234567890123' }] } })
}), { status: 200 })

describe('SF standard API signed requests', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('sends the SF URL-encoded MD5/Base64 digest and standard production endpoint', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const seen: Array<{ url: string; body: URLSearchParams }> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = new URLSearchParams(String(init?.body || ''))
      seen.push({ url, body })
      return orderResponse(body.get('msgData') ? JSON.parse(body.get('msgData')!).orderId : '')
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await lookupSfOrder('order-one', config)).toBe('SF1234567890123')
    expect(await lookupSfOrder('order-two', config)).toBe('SF1234567890123')
    const serviceCalls = seen.filter(call => call.url.endsWith('/std/service'))
    expect(seen).toHaveLength(2)
    expect(serviceCalls).toHaveLength(2)
    expect(serviceCalls.every(call => call.url === 'https://sfapi.sf-express.com/std/service')).toBe(true)
    const first = serviceCalls[0].body
    expect(first.get('partnerID')).toBe(config.partnerId)
    expect(first.get('timestamp')).toBe('1700000000000')
    expect(first.get('serviceCode')).toBe('EXP_RECE_SEARCH_ORDER_RESP')
    expect(first.get('msgDigest')).toBe('grbO+cblrAHrHcqJetxtIA==')
    expect(first.has('accessToken')).toBe(false)
    expect(first.get('msgData')).toBe(JSON.stringify({ orderId: 'order-one', language: 'zh-CN', searchType: '1' }))
    expect(first.get('requestID')).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('uses PHP urlencode-compatible UTF-8 escaping for real-world message text', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    let submitted = new URLSearchParams()
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      submitted = new URLSearchParams(String(init?.body || ''))
      return new Response(JSON.stringify({ apiResultCode: 'A1000', apiResultData: { success: true, msgData: {} } }), { status: 200 })
    }))
    const message = { contact: "寄件 A+~!'()*" }
    await sfCall('EXP_RECE_SEARCH_ORDER_RESP', message, { ...config, checkWord: 'check-word' })
    expect(submitted.get('msgData')).toBe(JSON.stringify(message))
    expect(submitted.get('msgDigest')).toBe('ItVRI12/cTTqD9Q7D8F4rg==')
  })
})
