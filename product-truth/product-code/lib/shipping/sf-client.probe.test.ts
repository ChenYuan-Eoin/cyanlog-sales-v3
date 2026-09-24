import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeSfSandbox } from './sf-client'

describe('SF sandbox signed connectivity probe', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('uses the read-only standard API with partnerID and msgDigest, without creating a shipment', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      apiResultCode: 'A1000',
      apiResultData: JSON.stringify({ success: false, errorCode: 'ORDER_NOT_FOUND' })
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await probeSfSandbox('partner-probe-unique', 'check-word-probe')
    expect(result.connected).toBe(true)
    expect(result.message).toContain('标准接口签名')
    expect(result.message).toContain('未创建运单')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://sfapi-sbox.sf-express.com/std/service')
    const body = new URLSearchParams(String(init.body))
    expect(body.get('partnerID')).toBe('partner-probe-unique')
    expect(body.get('serviceCode')).toBe('EXP_RECE_SEARCH_ORDER_RESP')
    expect(body.get('timestamp')).toBe('1700000000000')
    expect(body.get('msgDigest')).toBeTruthy()
    expect(body.has('secret')).toBe(false)
    expect(body.has('accessToken')).toBe(false)
    expect(body.get('msgData')).toMatch(/"searchType":"1"/)
    expect(body.get('requestID')).toMatch(/^[0-9a-f-]{36}$/i)
  })

  it('does not mark signature or permission rejection as a successful connection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ apiResultCode: 'A1011', apiErrorMsg: 'private upstream details' }), { status: 200 })))
    const result = await probeSfSandbox('partner-rejected-unique', 'secret-checkword')
    expect(result.connected).toBe(false)
    expect(result.message).toContain('未接受签名')
    expect(result.message).not.toContain('private upstream details')
  })

  it('reports transport failure without exposing provider details or credentials', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const timeout = Object.assign(new Error('fixture transport failure'), { cause: { code: 'UND_ERR_CONNECT_TIMEOUT' } })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(timeout))
    expect(await probeSfSandbox('p'.repeat(14), 'c'.repeat(32))).toEqual({ connected: false, message: '顺丰网关连接超时，未收到顺丰响应。 凭据/签名尚未验证，也未创建运单。' })
    expect(JSON.stringify(log.mock.calls)).not.toContain('fixture transport failure')
    expect(JSON.stringify(log.mock.calls)).not.toContain('c'.repeat(32))
    expect(JSON.stringify(log.mock.calls)).toContain('UND_ERR_CONNECT_TIMEOUT')
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
