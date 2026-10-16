import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSfOrder, lookupSfOrder, probeSfProduction, cancelSfOrder } from './sf-client'
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

  it('binds concurrent requests and cached tokens to the reachable Hong Kong production gateway', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const timeout = vi.spyOn(AbortSignal, 'timeout')
    const seen: Array<{ url: string; body: URLSearchParams }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input), body = new URLSearchParams(String(init?.body))
      seen.push({ url, body })
      if (url.endsWith('/oauth2/accessToken')) {
        if (!url.includes('sfapi-hk.')) throw new DOMException('timeout', 'TimeoutError')
        return Response.json({ apiResultCode: 'A1000', accessToken: 'example-hk-token-fixture', expiresIn: 7200 })
      }
      return orderResponse(JSON.parse(body.get('msgData')!).orderId)
    }))
    const isolated = { ...config, partnerId: 'hk-concurrent-example' }
    expect(await Promise.all(['hk-one', 'hk-two'].map(id => lookupSfOrder(id, isolated)))).toEqual(['SF1234567890123', 'SF1234567890123'])
    await lookupSfOrder('hk-cached', isolated)
    expect(seen.filter(call => call.url.endsWith('/oauth2/accessToken')).map(call => call.url)).toEqual([
      'https://bspgw.sf-express.com/oauth2/accessToken', 'https://sfapi.sf-express.com/oauth2/accessToken', 'https://sfapi-hk.sf-express.com/oauth2/accessToken',
    ])
    const serviceCalls = seen.filter(call => call.url.endsWith('/std/service'))
    expect(serviceCalls).toHaveLength(3)
    expect(serviceCalls.every(call => call.url === 'https://sfapi-hk.sf-express.com/std/service' && call.body.get('accessToken') === 'example-hk-token-fixture')).toBe(true)
    expect(timeout.mock.calls.filter(([ms]) => ms === 4000)).toHaveLength(3)
    expect(info).toHaveBeenCalledWith('shipping.sf.oauth_fallback_succeeded', expect.objectContaining({ endpointHostname: 'sfapi-hk.sf-express.com' }))
    expect(JSON.stringify(info.mock.calls)).not.toContain('example-hk-token-fixture')
  })

  it('uses the authenticated Hong Kong gateway for a read-only production probe', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const seen: Array<{ url: string; body: URLSearchParams }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input), body = new URLSearchParams(String(init?.body)); seen.push({ url, body })
      if (url.endsWith('/oauth2/accessToken')) {
        if (!url.includes('sfapi-hk.')) throw new DOMException('timeout', 'TimeoutError')
        return Response.json({ apiResultCode: 'A1000', accessToken: 'example-hk-probe-token', expiresIn: 7200 })
      }
      return Response.json({ apiResultCode: 'A1000', apiResultData: { success: false, errorCode: '6150' } })
    }))
    expect(await probeSfProduction('hk-probe-example', config.checkWord)).toMatchObject({ connected: true, queryVerified: true })
    const businessCalls = seen.filter(call => call.body.has('serviceCode'))
    expect(businessCalls).toHaveLength(1)
    expect(businessCalls[0].url).toBe('https://sfapi-hk.sf-express.com/std/service')
    expect(businessCalls[0].body.get('serviceCode')).toBe('EXP_RECE_SEARCH_ORDER_RESP')
  })

  it.each(['create', 'cancel'])('does not retry an uncertain %s after Hong Kong authentication fallback', async operation => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/oauth2/accessToken')) {
        if (!url.includes('sfapi-hk.')) throw new DOMException('timeout', 'TimeoutError')
        return Response.json({ apiResultCode: 'A1000', accessToken: 'example-hk-write-token', expiresIn: 7200 })
      }
      throw new DOMException('timeout', 'TimeoutError')
    })
    vi.stubGlobal('fetch', fetchMock)
    const isolated = { ...config, partnerId: `hk-uncertain-${operation}` }
    const request = operation === 'create'
      ? createSfOrder('hk-uncertain', { sender: config.sender, recipient: config.sender, cargo: '文件', weight: 1, remark: '', serviceId: 2, source: 'manual' }, isolated)
      : cancelSfOrder('hk-uncertain', isolated)
    await expect(request).rejects.toMatchObject({ requestStage: 'provider_unreachable' })
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/std/service')).map(([url]) => url)).toEqual(['https://sfapi-hk.sf-express.com/std/service'])
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

  it.each(['timeout', 'http', 'invalid', 'rejected'])('proves create was not sent when authentication fails: %s', async mode => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const fetchMock = vi.fn(async (_url: RequestInfo | URL) => {
      if (mode === 'timeout') throw new DOMException('timeout', 'TimeoutError')
      if (mode === 'http') return new Response('unavailable', { status: 503 })
      if (mode === 'invalid') return new Response('not-json')
      return Response.json({ apiResultCode: 'A1011' })
    })
    vi.stubGlobal('fetch', fetchMock)
    const isolated = { ...config, partnerId: `create-auth-${mode}` }
    await expect(createSfOrder('create-not-sent', { sender: config.sender, recipient: config.sender, cargo: '文件', weight: 1, remark: '', serviceId: 2, source: 'manual' }, isolated)).rejects.toMatchObject({ requestStage: 'provider_not_sent', message: expect.stringContaining('尚未发送') })
    expect(fetchMock.mock.calls.length).toBe(mode === 'timeout' ? 3 : 1)
    expect(fetchMock.mock.calls.every(call => String(call[0]).endsWith('/oauth2/accessToken'))).toBe(true)
  })

  it('never labels a business timeout as not-sent or repeats the create request', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).endsWith('/oauth2/accessToken')) return Response.json({ apiResultCode: 'A1000', accessToken: 'example-create-token', expiresIn: 7200 })
      throw new DOMException('timeout', 'TimeoutError')
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(createSfOrder('create-unknown', { sender: config.sender, recipient: config.sender, cargo: '文件', weight: 1, remark: '', serviceId: 2, source: 'manual' }, { ...config, partnerId: 'create-business-timeout' })).rejects.toMatchObject({ requestStage: 'provider_unreachable' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.filter(call => String(call[0]).endsWith('/std/service'))).toHaveLength(1)
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
