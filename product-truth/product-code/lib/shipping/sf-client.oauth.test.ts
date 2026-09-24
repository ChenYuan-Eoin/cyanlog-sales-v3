import { afterEach, describe, expect, it, vi } from 'vitest'
import { lookupSfOrder } from './sf-client'
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

describe('SF OAuth2 API requests', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('sends accessToken instead of msgDigest to the production API and reuses a valid cached token', async () => {
    const seen: Array<{ url: string; body: URLSearchParams }> = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const body = new URLSearchParams(String(init?.body || ''))
      seen.push({ url, body })
      if (url.endsWith('/oauth2/accessToken')) return new Response(JSON.stringify({ apiResultCode: 'A1000', accessToken: 't'.repeat(48), expiresIn: 7200 }), { status: 200 })
      return orderResponse(body.get('msgData') ? JSON.parse(body.get('msgData')!).orderId : '')
    })
    vi.stubGlobal('fetch', fetchMock)

    expect(await lookupSfOrder('order-one', config)).toBe('SF1234567890123')
    expect(await lookupSfOrder('order-two', config)).toBe('SF1234567890123')
    const tokenCalls = seen.filter(call => call.url.endsWith('/oauth2/accessToken'))
    const serviceCalls = seen.filter(call => call.url.endsWith('/std/service'))
    expect(tokenCalls).toHaveLength(1)
    expect(tokenCalls[0].url).toBe('https://bspgw.sf-express.com/oauth2/accessToken')
    expect(tokenCalls[0].body.get('secret')).toBe(config.checkWord)
    expect(tokenCalls[0].body.get('grantType')).toBe('password')
    expect(serviceCalls).toHaveLength(2)
    expect(serviceCalls.every(call => call.url === 'https://bspgw.sf-express.com/std/service')).toBe(true)
    expect(serviceCalls.map(call => call.body.get('accessToken'))).toEqual(['t'.repeat(48), 't'.repeat(48)])
    expect(serviceCalls.every(call => !call.body.has('msgDigest'))).toBe(true)
  })

  it('refreshes the token before its expiry window', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000)
    let tokenSequence = 0
    const tokens: string[] = []
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/oauth2/accessToken')) {
        tokenSequence += 1
        const accessToken = `refresh-token-${tokenSequence}`
        tokens.push(accessToken)
        return new Response(JSON.stringify({ apiResultCode: 'A1000', accessToken, expiresIn: 120 }), { status: 200 })
      }
      const body = new URLSearchParams(String(init?.body || ''))
      return orderResponse(JSON.parse(body.get('msgData') || '{}').orderId)
    })
    vi.stubGlobal('fetch', fetchMock)

    await lookupSfOrder('refresh-one', { ...config, partnerId: 'r'.repeat(12) })
    now.mockReturnValue(1_061_000)
    await lookupSfOrder('refresh-two', { ...config, partnerId: 'r'.repeat(12) })
    expect(tokens).toEqual(['refresh-token-1', 'refresh-token-2'])
  })
})
