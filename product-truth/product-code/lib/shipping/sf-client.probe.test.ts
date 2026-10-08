import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeSfProduction, probeSfSandbox, sfCall } from './sf-client'

describe('SF sandbox OAuth2 connectivity probe', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('obtains a sandbox OAuth2 token and calls the read-only standard API without creating a shipment', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ apiResultCode: 'A1000', accessToken: 'test-placeholder-token', expiresIn: 7200 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        apiResultCode: 'A1000',
        apiResultData: JSON.stringify({ success: false, errorCode: 'ORDER_NOT_FOUND' })
      }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await probeSfSandbox('partner-probe-unique', 'check-word-probe')
    expect(result.connected).toBe(true)
    expect(result.message).toContain('OAuth2认证')
    expect(result.message).toContain('未创建运单')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(tokenUrl).toBe('https://sfapi-sbox.sf-express.com/oauth2/accessToken')
    const tokenBody = new URLSearchParams(String(tokenInit.body))
    expect(tokenBody.get('partnerID')).toBe('partner-probe-unique')
    expect(tokenBody.get('secret')).toBe('check-word-probe')
    expect(tokenBody.get('grantType')).toBe('password')

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(url).toBe('https://sfapi-sbox.sf-express.com/std/service')
    const body = new URLSearchParams(String(init.body))
    expect(body.get('partnerID')).toBe('partner-probe-unique')
    expect(body.get('serviceCode')).toBe('EXP_RECE_SEARCH_ORDER_RESP')
    expect(body.get('timestamp')).toBe('1700000000000')
    expect(body.get('accessToken')).toBe('test-placeholder-token')
    expect(body.has('msgDigest')).toBe(false)
    expect(body.has('secret')).toBe(false)
    expect(body.get('msgData')).toMatch(/"searchType":"1"/)
    expect(body.get('requestID')).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('does not mark OAuth2 credential rejection as a successful connection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ apiResultCode: 'A1011', apiErrorMsg: 'private upstream details' }), { status: 200 })))
    const result = await probeSfSandbox('partner-rejected-unique', 'secret-checkword')
    expect(result.connected).toBe(false)
    expect(result.message).toContain('OAuth2认证失败')
    expect(result.message).not.toContain('private upstream details')
  })

  it('reports transport failure without exposing provider details or credentials', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const timeout = Object.assign(new Error('fixture transport failure'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout))
    expect(await probeSfSandbox('p'.repeat(14), 'c'.repeat(32))).toEqual({ connected: false, message: '顺丰OAuth2认证连接超时，未收到顺丰响应。 凭据尚未验证，也未创建运单。' })
    expect(JSON.stringify(log.mock.calls)).not.toContain('fixture transport failure')
    expect(JSON.stringify(log.mock.calls)).not.toContain('c'.repeat(32))
    expect(JSON.stringify(log.mock.calls)).toContain('UND_ERR_CONNECT_TIMEOUT')
  })

  it.each(['attempted addresses', 'attempted address'])('logs only validated IPs from %s and the runtime region for an OAuth connection timeout', async fragmentLabel => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('VERCEL_REGION', 'sin1')
    const cause = Object.assign(new AggregateError([
      Object.assign(new Error('private child message'), { address: '192.0.2.9' }),
      Object.assign(new Error('private malformed address'), { address: 'credential-fixture.example:443' }),
    ], `Connect Timeout Error (${fragmentLabel}: 203.0.113.2:443, [2001:db8::3]:8443, credential-fixture, timeout: 10000ms) private upstream content`), {
      code: 'UND_ERR_CONNECT_TIMEOUT', address: '198.51.100.1:443',
    })
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('private top-level failure', { cause }))
    vi.stubGlobal('fetch', fetchMock)
    await probeSfSandbox('partner-diagnostics-unique', 'private-checkword-diagnostics')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith('shipping.sf.oauth_transport', expect.objectContaining({
      endpointHostname: 'sfapi-sbox.sf-express.com', runtimeRegion: 'sin1', networkCode: 'UND_ERR_CONNECT_TIMEOUT',
      attemptedAddresses: [
        { address: '198.51.100.1', family: 4 },
        { address: '203.0.113.2', family: 4 },
        { address: '2001:db8::3', family: 6 },
        { address: '192.0.2.9', family: 4 },
      ],
    }))
    const serialized = JSON.stringify(log.mock.calls)
    for (const privateValue of ['private', 'credential-fixture', 'partner-diagnostics-unique', 'attempted addresses:', 'timeout: 10000ms']) expect(serialized).not.toContain(privateValue)
  })

  it('rejects malformed metadata instead of logging hostnames, invalid ports or arbitrary IP-containing messages', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('VERCEL_REGION', 'sin1 private-region')
    const error = Object.assign(new Error('credentials in an arbitrary message 203.0.113.4'), {
      name: 'private-error-type',
      cause: { code: 'EPRIVATE_TOKEN', address: '203.0.113.3:99999', message: 'private network detail with 192.0.2.8', errors: [{ address: '999.999.999.999:443' }, { address: '[2001:db8::1]:443/private-token' }] },
    })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
    await probeSfSandbox('partner-invalid-metadata', 'private-checkword-metadata')
    expect(log).toHaveBeenCalledWith('shipping.sf.oauth_transport', expect.objectContaining({ endpointHostname: 'sfapi-sbox.sf-express.com', attemptedAddresses: [] }))
    const metadata = log.mock.calls[0][1]
    expect(metadata.runtimeRegion).toBeUndefined()
    expect(metadata.errorType).toBeUndefined()
    expect(metadata.networkCode).toBeUndefined()
    const serialized = JSON.stringify(log.mock.calls)
    expect(serialized).not.toContain('private')
    expect(serialized).not.toContain('203.0.113.4')
    expect(serialized).not.toContain('192.0.2.8')
  })

  it('adds the same safe destination metadata to service transport failures without exposing its token', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('VERCEL_REGION', 'sin1')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ apiResultCode: 'A1000', accessToken: 'example-service-token', expiresIn: 7200 }), { status: 200 }))
      .mockRejectedValueOnce(new TypeError('private service failure', { cause: { code: 'ECONNRESET', address: '[2001:db8::4]:443', message: 'private service detail' } }))
    vi.stubGlobal('fetch', fetchMock)
    await probeSfSandbox('partner-service-diagnostics', 'private-service-checkword')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith('shipping.sf.transport', expect.objectContaining({
      endpointHostname: 'sfapi-sbox.sf-express.com', runtimeRegion: 'sin1', networkCode: 'ECONNRESET',
      attemptedAddresses: [{ address: '2001:db8::4', family: 6 }],
    }))
    expect(JSON.stringify(log.mock.calls)).not.toContain('private')
    expect(JSON.stringify(log.mock.calls)).not.toContain('partner-service-diagnostics')
    expect(JSON.stringify(log.mock.calls)).not.toContain('example-service-token')
  })

  it.each([200, 503])('records only safe HTTP response metadata for status %s without adding provider calls', async status => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubEnv('VERCEL_REGION', status === 200 ? 'hkg1' : 'private-invalid-region')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ apiResultCode: 'A1000', accessToken: 'example-response-token', expiresIn: 7200 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ apiResultCode: 'A1000', apiResultData: { success: false, errorCode: '6150', msgData: { note: 'private-business-details' } } }), { status, headers: { 'x-private-provider-header': 'private-provider-header-value' } }))
    vi.stubGlobal('fetch', fetchMock)
    const call = sfCall('EXP_RECE_SEARCH_ORDER_RESP', { orderId: 'private-order-id', language: 'zh-CN', searchType: '1' }, { environment: 'sandbox', partnerId: `private-response-partner-${status}`, checkWord: 'private-response-checkword' })
    if (status === 200) await expect(call).rejects.toMatchObject({ requestStage: 'provider_rejected', status: 422, message: '顺丰未找到该订单（6150）。' })
    else await expect(call).rejects.toMatchObject({ requestStage: 'provider_http_error', status: 502 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const serviceBody = new URLSearchParams(String(fetchMock.mock.calls[1][1].body))
    expect(serviceBody.get('serviceCode')).toBe('EXP_RECE_SEARCH_ORDER_RESP')
    expect(info).toHaveBeenCalledTimes(1)
    expect(info).toHaveBeenCalledWith('shipping.sf.response', {
      serviceCode: 'EXP_RECE_SEARCH_ORDER_RESP', environment: 'sandbox', endpointHostname: 'sfapi-sbox.sf-express.com',
      runtimeRegion: status === 200 ? 'hkg1' : undefined, status, elapsedMs: expect.any(Number),
    })
    expect(JSON.stringify(info.mock.calls)).not.toContain('private')
    expect(JSON.stringify(info.mock.calls)).not.toContain('example-response-token')
  })

  it('distinguishes an HTTP response from a network timeout without returning upstream details', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private gateway detail', { status: 503 })))
    const result = await probeSfSandbox('partner-http-unique', 'private-checkword')
    expect(result.connected).toBe(false)
    expect(result.message).toContain('HTTP错误（503）')
    expect(result.message).toContain('未创建运单')
    expect(result.message).not.toContain('private gateway detail')
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-checkword')
  })
})

describe('SF Production read-only connectivity probe', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('checks Production OAuth2 and the read-only order-query API without creating an order', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ apiResultCode: 'A1000', accessToken: 'test-placeholder-production-token', expiresIn: 7200 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ apiResultCode: 'A1000', apiResultData: JSON.stringify({ success: false, errorCode: 'ORDER_NOT_FOUND' }) }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await probeSfProduction('production-partner', 'production-check-word-fixture')

    expect(result).toMatchObject({ connected: true, queryVerified: true })
    expect(result.message).toContain('顺丰生产OAuth2认证及只读API连通通过')
    expect(result.message).toContain('未创建运单')
    expect(result.message).toContain('下单能力仍需')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(tokenUrl).toBe('https://bspgw.sf-express.com/oauth2/accessToken')
    expect(new URLSearchParams(String(tokenInit.body)).get('secret')).toBe('production-check-word-fixture')
    const [serviceUrl, serviceInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(serviceUrl).toBe('https://sfapi.sf-express.com/std/service')
    const body = new URLSearchParams(String(serviceInit.body))
    expect(body.get('serviceCode')).toBe('EXP_RECE_SEARCH_ORDER_RESP')
    expect(body.get('accessToken')).toBe('test-placeholder-production-token')
    expect(body.has('msgDigest')).toBe(false)
    expect(body.get('msgData')).toMatch(/"searchType":"1"/)
  })
})
