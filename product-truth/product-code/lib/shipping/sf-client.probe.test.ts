import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeSfSandbox } from './sf-client'

describe('SF sandbox OAuth2 connectivity probe', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('requests an OAuth2 token, then checks the read-only standard API without creating an order or sending a digest', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ apiResultCode: 'A1000', accessToken: 's'.repeat(48), expiresIn: 7200 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ apiResultCode: 'A1000', apiResultData: JSON.stringify({ success: false, errorCode: 'ORDER_NOT_FOUND' }) }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await probeSfSandbox('partner-probe-unique', 'check-word-probe')
    expect(result.connected).toBe(true)
    expect(result.message).toContain('只读API连通通过')
    expect(result.message).toContain('未创建运单')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(tokenUrl).toBe('https://sfapi-sbox.sf-express.com/oauth2/accessToken')
    const tokenBody = new URLSearchParams(String(tokenInit.body))
    expect(tokenBody.get('partnerID')).toBe('partner-probe-unique')
    expect(tokenBody.get('secret')).toBe('check-word-probe')
    expect(tokenBody.get('grantType')).toBe('password')
    expect(tokenBody.has('msgDigest')).toBe(false)
    expect(new Headers(tokenInit.headers).get('Content-Type')).toContain('application/x-www-form-urlencoded')
    const [serviceUrl, serviceInit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(serviceUrl).toBe('https://sfapi-sbox.sf-express.com/std/service')
    const serviceBody = new URLSearchParams(String(serviceInit.body))
    expect(serviceBody.get('serviceCode')).toBe('EXP_RECE_SEARCH_ORDER_RESP')
    expect(serviceBody.get('accessToken')).toBe('s'.repeat(48))
    expect(serviceBody.has('msgDigest')).toBe(false)
    expect(JSON.parse(serviceBody.get('msgData') || '{}')).toMatchObject({ language: 'zh-CN', searchType: '1' })
  })

  it('reports OAuth2 rejection and transport failure without exposing provider details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ apiResultCode: 'A1011', apiErrorMsg: 'private upstream details', accessToken: null, expiresIn: null }), { status: 200 })))
    const authFailure = await probeSfSandbox('partner-rejected-unique', 'secret-checkword')
    expect(authFailure.connected).toBe(false)
    expect(authFailure.message).toContain('认证失败')
    expect(authFailure.message).not.toContain('private upstream details')

    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fixture transport failure')))
    expect(await probeSfSandbox('p'.repeat(14), 'c'.repeat(32))).toEqual({ connected: false, message: '无法连接顺丰OAuth2认证服务，请稍后重试。' })
    expect(JSON.stringify(log.mock.calls)).not.toContain('fixture transport failure')
    expect(JSON.stringify(log.mock.calls)).not.toContain('c'.repeat(32))
  })

  it('distinguishes a valid OAuth2 credential from an unenabled read-only API', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ apiResultCode: 'A1000', accessToken: 'r'.repeat(48), expiresIn: 7200 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ apiResultCode: 'A1004' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await probeSfSandbox('partner-query-denied', 'credential-fixture')
    expect(result.connected).toBe(true)
    expect(result.message).toContain('业务接口权限仍需分别核验')
  })
})
