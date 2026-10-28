// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { executeRequest, MAX_RESPONSE_BYTES, validRequest, validResult } from './protocol.mjs'
const tokenRequest = () => ({ url: 'https://open.fxiaoke.com/oauth2.0/token?thirdTraceId=11111111-1111-4111-8111-111111111111',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appId: 'FSAID_test', appSecret: 'example-secret', permanentCode: 'fixture-permanent', grantType: 'app_secret' }) })
it('only forwards the exact official token grant', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"errorCode":0}', { status: 200 }))
  expect(validRequest(tokenRequest())).toBe(true)
  expect(await executeRequest(tokenRequest(), fetcher)).toEqual({ status: 200, body: '{"errorCode":0}' })
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' })
})
it.each(['http://open.fxiaoke.com/oauth2.0/token', 'https://open.fxiaoke.com.evil.example/oauth2.0/token',
  'https://open.fxiaoke.com/cgi/crm/v2/data/create', 'https://127.0.0.1/oauth2.0/token', 'https://user@open.fxiaoke.com/oauth2.0/token'])('rejects non-allowlisted destination %s without fetching', async url => {
  const request = { ...tokenRequest(), url: `${url}?thirdTraceId=11111111-1111-4111-8111-111111111111` }
  const fetcher = vi.fn()
  expect(await executeRequest(request, fetcher)).toEqual({ error: 'INVALID_RESPONSE' })
  expect(fetcher).not.toHaveBeenCalled()
})
it('rejects custom grants, extra secrets in URL, arbitrary headers and query object access', () => {
  expect(validRequest({ ...tokenRequest(), url: `${tokenRequest().url}&secret=leak` })).toBe(false)
  expect(validRequest({ ...tokenRequest(), headers: { ...tokenRequest().headers, cookie: 'session' } })).toBe(false)
  expect(validRequest({ ...tokenRequest(), body: tokenRequest().body.replace('app_secret','authorization_code') })).toBe(false)
  const query = { url: tokenRequest().url.replace('/oauth2.0/token','/cgi/crm/v2/data/query'),
    headers: { 'content-type': 'application/json', authorization: 'Bearer fixture-token', 'x-fs-ea': 'enterprise', 'x-fs-userid': '123' },
    body: JSON.stringify({ convertUserId: false, data: { dataObjectApiName: 'DepartmentObj', search_query_info: { limit: 100, offset: 0, fieldProjection: ['_id','name','parent_id','status'], filters: [] } } }) }
  expect(validRequest(query)).toBe(true)
  expect(validRequest({ ...query, body: query.body.replace('DepartmentObj','AccountObj') })).toBe(false)
  expect(validRequest({ ...query, body: query.body.replace('"offset":0','"offset":100000') })).toBe(false)
})
it('caps responses and never serializes provider exceptions', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('x'.repeat(MAX_RESPONSE_BYTES + 1)))
  expect(await executeRequest(tokenRequest(), fetcher)).toEqual({ error: 'INVALID_RESPONSE' })
  fetcher.mockRejectedValue(new Error('example-secret provider response'))
  expect(await executeRequest(tokenRequest(), fetcher)).toEqual({ error: 'NETWORK' })
  expect(validResult({ error: 'example-secret' })).toBe(false)
})
