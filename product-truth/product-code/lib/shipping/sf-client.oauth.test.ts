import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelSfOrder, lookupSfOrder } from './sf-client'
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

describe('SF Node.js OAuth2 API requests', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('obtains a server-side token and uses it on the standard production API', async () => {
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
    expect(tokenCalls[0].body.get('partnerID')).toBe(config.partnerId)
    expect(tokenCalls[0].body.get('secret')).toBe(config.checkWord)
    expect(tokenCalls[0].body.get('grantType')).toBe('password')
    expect(serviceCalls).toHaveLength(2)
    expect(serviceCalls.every(call => call.url === 'https://sfapi.sf-express.com/std/service')).toBe(true)
    expect(serviceCalls.every(call => call.body.get('accessToken') === 't'.repeat(48))).toBe(true)
    expect(serviceCalls.every(call => !call.body.has('msgDigest'))).toBe(true)
  })

  it('uses the other documented production token endpoint after a connection timeout', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input); calls.push(url)
      if (url.startsWith('https://bspgw.')) throw Object.assign(new TypeError('connect failed'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })
      if (url.endsWith('/oauth2/accessToken')) return Response.json({ apiResultCode: 'A1000', accessToken: 'example-fallback-token', expiresIn: 7200 })
      return orderResponse(JSON.parse(new URLSearchParams(String(init?.body)).get('msgData')!).orderId)
    }))
    const isolated = { ...config, partnerId: 'fallback-example' }
    expect(await lookupSfOrder('fallback-order', isolated)).toBe('SF1234567890123')
    expect(calls).toEqual(['https://bspgw.sf-express.com/oauth2/accessToken', 'https://sfapi.sf-express.com/oauth2/accessToken', 'https://sfapi.sf-express.com/std/service'])
    expect(warn).toHaveBeenCalled(); expect(info).toHaveBeenCalled()
    expect(JSON.stringify([warn.mock.calls, info.mock.calls])).not.toContain(isolated.checkWord)
    expect(JSON.stringify([warn.mock.calls, info.mock.calls])).not.toContain('example-fallback-token')
  })

  it.each(['certificate', 'http', 'credentials'])('does not fail over a %s rejection', async mode => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn(async () => {
      if (mode === 'certificate') throw Object.assign(new TypeError('certificate failure'), { cause: { code: 'CERT_HAS_EXPIRED' } })
      if (mode === 'http') return new Response('denied', { status: 403 })
      return Response.json({ apiResultCode: 'A1011', accessToken: null, expiresIn: null })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(lookupSfOrder('no-fallback', { ...config, partnerId: `example-${mode}` })).rejects.toMatchObject({ status: 502 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('never sends sandbox credentials to the production fallback', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new TypeError('timeout'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(lookupSfOrder('sandbox-only', { ...config, environment: 'sandbox', partnerId: 'sandbox-example' })).rejects.toMatchObject({ requestStage: 'provider_unreachable' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://sfapi-sbox.sf-express.com/oauth2/accessToken')
  })

  it('refreshes the token before expiry and does not log or persist it', async () => {
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
    const postedBodies = fetchMock.mock.calls.map(call => String((call[1] as RequestInit).body || ''))
    expect(postedBodies.some(body => body.includes('msgDigest='))).toBe(false)
  })
})


describe('SF cancellation convergence', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it.each(['canceled', 'missing', 'gateway', 'mismatched', 'transport'])('handles %s without confusing rejection and cancellation', async mode => {
    const requests: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).endsWith('/oauth2/accessToken')) return Response.json({ apiResultCode: 'A1000', accessToken: 't'.repeat(48), expiresIn: 7200 })
      const form = new URLSearchParams(String(init?.body))
      expect(form.get('serviceCode')).toBe('EXP_RECE_UPDATE_ORDER')
      requests.push(JSON.parse(form.get('msgData')!))
      if (mode === 'transport') throw new TypeError('network lost')
      return Response.json({
        apiResultCode: mode === 'gateway' ? '8037' : 'A1000',
        apiResultData: JSON.stringify(mode === 'mismatched'
          ? { success: true, msgData: { orderId: 'another-order' } }
          : { success: false, errorCode: mode === 'missing' ? '6150' : '8037', errorMsg: 'private provider details' })
      })
    }))
    const result = cancelSfOrder('same-order', { ...config, partnerId: `cancel-${mode}` })
    if (mode === 'canceled') await expect(result).resolves.toBe(true)
    else await expect(result).rejects.toThrow()
    expect(requests).toEqual([{ orderId: 'same-order', dealType: 2, language: 'zh-CN' }])
  })

  it('keeps already-canceled lookup distinct from order-not-found', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => String(input).endsWith('/oauth2/accessToken')
      ? Response.json({ apiResultCode: 'A1000', accessToken: 't'.repeat(48), expiresIn: 7200 })
      : Response.json({ apiResultCode: 'A1000', apiResultData: JSON.stringify({ success: false, errorCode: '8037' }) })))
    await expect(lookupSfOrder('same-order', { ...config, partnerId: 'canceled-lookup' })).rejects.toMatchObject({
      providerBusinessCode: '8037', message: '顺丰订单已取消（8037）。'
    })
  })
})
