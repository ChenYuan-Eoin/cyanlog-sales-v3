import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeSfSandbox } from './sf-client'

describe('SF sandbox OAuth2 connectivity probe', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('requests a server-side token without creating an order or sending a digest', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ apiResultCode: 'A1000', accessToken: 's'.repeat(48), expiresIn: 7200 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await probeSfSandbox('partner-probe-unique', 'check-word-probe')
    expect(result.connected).toBe(true)
    expect(result.message).toContain('未创建运单')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://sfapi-sbox.sf-express.com/oauth2/accessToken')
    const body = new URLSearchParams(String(init.body))
    expect(body.get('partnerID')).toBe('partner-probe-unique')
    expect(body.get('secret')).toBe('check-word-probe')
    expect(body.get('grantType')).toBe('password')
    expect(body.has('msgDigest')).toBe(false)
    expect(new Headers(init.headers).get('Content-Type')).toContain('application/x-www-form-urlencoded')
  })

  it('reports OAuth2 rejection and transport failure without exposing provider details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ apiResultCode: 'A1011', apiErrorMsg: 'private upstream details', accessToken: null, expiresIn: null }), { status: 200 })))
    const authFailure = await probeSfSandbox('partner-rejected-unique', 'secret-checkword')
    expect(authFailure.connected).toBe(false)
    expect(authFailure.message).toContain('认证失败')
    expect(authFailure.message).not.toContain('private upstream details')

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network secret details')))
    expect(await probeSfSandbox('partner-network-unique', 'secret-checkword')).toEqual({ connected: false, message: '无法连接顺丰OAuth2认证服务，请稍后重试。' })
  })
})
