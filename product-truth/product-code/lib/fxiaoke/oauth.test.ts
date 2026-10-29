// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { buildFxiaokeAuthorizationUrl, exchangeFxiaokeAuthorizationCode } from './oauth'

const credentials = { appId: 'FSAID_test', appSecret: 'secret' }
const input = {
  code: 'authorization-code',
  redirectUrl: 'https://sales.cyanlog.icu/api/auth/fxiaoke/callback',
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Fxiaoke employee OAuth', () => {
  it('builds the official authorization-code URL with the fixed redirect and state', () => {
    const url = buildFxiaokeAuthorizationUrl({ appId: credentials.appId, ...input, state: 's'.repeat(43) })

    expect(url.origin).toBe('https://open.fxiaoke.com')
    expect(url.pathname).toBe('/oauth2.0/authorize')
    expect(url.searchParams.get('responseType')).toBe('code')
    expect(url.searchParams.get('appId')).toBe(credentials.appId)
    expect(url.searchParams.get('redirectUrl')).toBe(input.redirectUrl)
    expect(url.searchParams.get('state')).toBe('s'.repeat(43))
    expect(url.searchParams.get('thirdTraceId')).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('exchanges one code without exposing either provider token', async () => {
    const request = vi.fn().mockResolvedValue(response({
      errorCode: 0,
      openUserId: 'employee-open-id',
      corpId: 'FSCID_enterprise',
      accessToken: 'provider-access-token',
      refreshToken: 'provider-refresh-token',
      expiresIn: 7200,
    }))

    const result = await exchangeFxiaokeAuthorizationCode(credentials, input, request)

    expect(result).toEqual({
      openUserId: 'employee-open-id',
      corpId: 'FSCID_enterprise',
      expiresIn: 7200,
    })
    expect(JSON.stringify(result)).not.toContain('provider-access-token')
    expect(JSON.stringify(result)).not.toContain('provider-refresh-token')
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      redirectUrl: input.redirectUrl,
      code: input.code,
      grantType: 'authorization_code',
    })
    expect(request.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' })
  })

  it('rejects provider errors, malformed enterprise values and missing stable employee IDs', async () => {
    const valid = {
      errorCode: 0,
      openUserId: 'employee-open-id',
      corpId: 'FSCID_enterprise',
      accessToken: 'token',
      expiresIn: 7200,
    }

    for (const body of [
      { ...valid, errorCode: 20016, errorMessage: 'rejected' },
      { ...valid, corpId: 'enterprise-without-prefix' },
      { ...valid, openUserId: '' },
      { ...valid, accessToken: '' },
      { ...valid, expiresIn: 0 },
    ]) {
      await expect(exchangeFxiaokeAuthorizationCode(credentials, input, vi.fn().mockResolvedValue(response(body))))
        .rejects.toMatchObject({ status: expect.any(Number) })
    }
  })

  it('classifies network and provider HTTP failures without reflecting sensitive upstream errors', async () => {
    const network = new Error('sensitive host and credentials', { cause: { code: 'ENOTFOUND' } })
    await expect(exchangeFxiaokeAuthorizationCode(credentials, input, vi.fn().mockRejectedValue(network)))
      .rejects.toMatchObject({ code: 'PROVIDER_DNS' })
    await expect(exchangeFxiaokeAuthorizationCode(credentials, input, vi.fn().mockResolvedValue(new Response('secret', { status: 503 }))))
      .rejects.not.toThrow('secret')
  })
})
