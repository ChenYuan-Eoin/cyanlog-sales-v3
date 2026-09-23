import { afterEach, describe, expect, it, vi } from 'vitest'
import { probeSfSandbox } from './sf-client'

describe('SF sandbox connectivity probe', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses the sandbox read-only query endpoint and never calls create-order', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ apiResultCode: 'A1000', apiResultData: JSON.stringify({ success: false, errorCode: 'ORDER_NOT_FOUND' }) }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await probeSfSandbox('partner-1234', 'check-word')
    expect(result.connected).toBe(true)
    expect(result.message).toContain('不代表下单')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('sfapi-sbox.sf-express.com')
    expect(String(init.body)).toContain('EXP_RECE_SEARCH_ORDER_RESP')
    expect(String(init.body)).not.toContain('EXP_RECE_CREATE_ORDER')
  })

  it('reports provider authentication or connectivity rejection without leaking response details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ apiResultCode: 'A1003' }), { status: 200 })))
    expect(await probeSfSandbox('partner-1234', 'secret-checkword')).toEqual({ connected: false, message: '顺丰沙盒拒绝了签名请求，请核对PartnerID和CheckWord。' })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network secret details')))
    expect(await probeSfSandbox('partner-1234', 'secret-checkword')).toEqual({ connected: false, message: '无法连接顺丰沙盒，请检查网络和机器凭据。' })
  })
})
