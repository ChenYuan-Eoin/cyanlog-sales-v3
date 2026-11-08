// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { executeRequest, MAX_RESPONSE_BYTES, validRequest, validResult } from './protocol.mjs'
const tokenRequest = () => ({ url: 'https://open.fxiaoke.com/oauth2.0/token?thirdTraceId=11111111-1111-4111-8111-111111111111',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ appId: 'FSAID_test', appSecret: 'example-secret', permanentCode: 'fixture-permanent', grantType: 'app_secret' }) })
const oauthRequest = () => ({ ...tokenRequest(), body: JSON.stringify({
  appId: 'FSAID_test', appSecret: 'example-secret',
  redirectUrl: 'https://sales.cyanlog.icu/api/auth/fxiaoke/callback',
  code: 'fixture-authorization-code', grantType: 'authorization_code',
}) })
it('only forwards the exact official token grant', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('{"errorCode":0}', { status: 200 }))
  expect(validRequest(tokenRequest())).toBe(true)
  expect(await executeRequest(tokenRequest(), fetcher)).toEqual({ status: 200, body: '{"errorCode":0}' })
  expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'error', cache: 'no-store' })
})
it('forwards the exact authorization-code grant through the shared worker protocol as POST', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ errorCode: 0 }))
  expect(validRequest(oauthRequest())).toBe(true)
  expect(await executeRequest(oauthRequest(), fetcher)).toEqual({ status: 200, body: '{"errorCode":0}' })
  expect(fetcher).toHaveBeenCalledWith(oauthRequest().url, expect.objectContaining({
    method: 'POST', redirect: 'error', cache: 'no-store', body: oauthRequest().body,
  }))
})
it.each([
  'http://sales.cyanlog.icu/api/auth/fxiaoke/callback',
  'https://cyanlog.icu/api/auth/fxiaoke/callback',
  'https://sales.cyanlog.icu.evil.example/api/auth/fxiaoke/callback',
  'https://sales.cyanlog.icu/api/auth/fxiaoke/start',
  'https://sales.cyanlog.icu/api/auth/fxiaoke/callback/',
  'https://sales.cyanlog.icu/api/auth/fxiaoke/callback?next=elsewhere',
  'https://sales.cyanlog.icu/api/auth/fxiaoke/callback#fragment',
  'https://user@sales.cyanlog.icu/api/auth/fxiaoke/callback',
])('rejects authorization-code callbacks outside the exact Production callback: %s', async redirectUrl => {
  const fetcher = vi.fn()
  const body = { ...JSON.parse(oauthRequest().body), redirectUrl }
  expect(await executeRequest({ ...oauthRequest(), body: JSON.stringify(body) }, fetcher)).toEqual({ error: 'INVALID_RESPONSE' })
  expect(fetcher).not.toHaveBeenCalled()
})
it.each([
  { code: '' }, { code: 'x'.repeat(2049) }, { code: 'code\r\nheader' },
  { appSecret: '' }, { appId: '' }, { code: 123 },
  { permanentCode: 'extra-secret' }, { grantType: 'refresh_token' },
])('rejects malformed or extra authorization-code fields: %o', fields => {
  expect(validRequest({ ...oauthRequest(), body: JSON.stringify({ ...JSON.parse(oauthRequest().body), ...fields }) })).toBe(false)
})
it('requires a fresh-shaped UUID v4 trace, exact query keys, exact headers and bounded code', () => {
  const input = oauthRequest()
  expect(validRequest({ ...input, url: input.url.replace('4111-8111', '1111-8111') })).toBe(false)
  expect(validRequest({ ...input, url: input.url.replace('11111111-1111-4111-8111-111111111111', 'a'.repeat(36)) })).toBe(false)
  expect(validRequest({ ...input, url: `${input.url}&thirdTraceId=11111111-1111-4111-8111-111111111111` })).toBe(false)
  expect(validRequest({ ...input, url: `${input.url}&code=leak` })).toBe(false)
  expect(validRequest({ ...input, headers: { ...input.headers, authorization: 'Bearer unexpected' } })).toBe(false)
  const { redirectUrl: _missing, ...body } = JSON.parse(input.body)
  expect(validRequest({ ...input, body: JSON.stringify(body) })).toBe(false)
  expect(validRequest({ ...input, body: JSON.stringify({ ...JSON.parse(input.body), code: 'x'.repeat(2048) }) })).toBe(true)
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
    body: JSON.stringify({ convertUserId: false, returnTotalNum: 1, data: { dataObjectApiName: 'DepartmentObj', search_query_info: { limit: 100, offset: 0, fieldProjection: ['_id','name','parent_id','status'], filters: [], orders: [{ fieldName: '_id', isAsc: true }] } } }) }
  const body = JSON.parse(query.body)
  expect(validRequest(query)).toBe(true)
  expect(validRequest({ ...query, body: JSON.stringify({
    ...body,
    data: { ...body.data, search_query_info: { ...body.data.search_query_info, filters: [{ field_name: '_id', field_values: ['100'], operator: 'GT' }] } },
  }) })).toBe(true)
  expect(validRequest({ ...query, body: JSON.stringify({ ...body, returnTotalNum: 2 }) })).toBe(false)
  expect(validRequest({ ...query, body: JSON.stringify((({ returnTotalNum: _total, ...rest }) => rest)(body)) })).toBe(false)
  expect(validRequest({ ...query, body: JSON.stringify({
    ...body,
    data: { ...body.data, search_query_info: { ...body.data.search_query_info, orders: [{ fieldName: '_id', isAsc: false }] } },
  }) })).toBe(false)
  expect(validRequest({ ...query, body: JSON.stringify({
    ...body,
    data: { ...body.data, search_query_info: { ...body.data.search_query_info, orders: [{ fieldName: 'name', isAsc: true }] } },
  }) })).toBe(false)
  expect(validRequest({ ...query, body: query.body.replace('DepartmentObj','AccountObj') })).toBe(false)
  expect(validRequest({ ...query, body: query.body.replace('"offset":0','"offset":100000') })).toBe(false)
})
it('allows only the exact PersonnelObj directory projection and rejects arbitrary fields', () => {
  const query = {
    url: tokenRequest().url.replace('/oauth2.0/token','/cgi/crm/v2/data/query'),
    headers: { 'content-type': 'application/json', authorization: 'Bearer fixture-token', 'x-fs-ea': 'enterprise', 'x-fs-userid': '123' },
    body: JSON.stringify({
      convertUserId: false,
      returnTotalNum: 1,
      data: {
        dataObjectApiName: 'PersonnelObj',
        search_query_info: {
          limit: 100,
          offset: 0,
          fieldProjection: ['_id','user_id','name','main_department','vice_departments','status','is_pause_login','employee_number','email','phone'],
          filters: [],
          orders: [{ fieldName: '_id', isAsc: true }],
        },
      },
    }),
  }
  expect(validRequest(query)).toBe(true)
  expect(validRequest({ ...query, body: query.body.replace('main_department','data_own_department') })).toBe(true)
  expect(validRequest({ ...query, body: query.body.replace('vice_departments','password') })).toBe(false)
  expect(validRequest({ ...query, body: query.body.replace('email','password') })).toBe(false)
})
it('keeps the previously deployed website protocol valid during worker rollout', () => {
  const response = {
    url: tokenRequest().url.replace('/oauth2.0/token','/cgi/crm/v2/data/query'),
    headers: { 'content-type': 'application/json', authorization: 'Bearer fixture-token', 'x-fs-ea': 'enterprise', 'x-fs-userid': '123' },
    body: JSON.stringify({
      convertUserId: false,
      data: {
        dataObjectApiName: 'PersonnelObj',
        search_query_info: {
          limit: 100,
          offset: 300,
          fieldProjection: ['_id','user_id','name','main_department','status','is_pause_login'],
          filters: [],
          orders: [],
        },
      },
    }),
  }
  expect(validRequest(response)).toBe(true)
  expect(validRequest({ ...response, body: response.body.replace('"offset":300','"offset":350') })).toBe(false)
  expect(validRequest({ ...response, body: response.body.replace('"offset":300','"offset":5100') })).toBe(false)
  expect(validRequest({ ...response, body: response.body.replace('"main_department"','"data_own_department"') })).toBe(false)
  expect(validRequest({ ...response, body: response.body.replace('"orders":[]','"orders":[{"fieldName":"_id","isAsc":true}]') })).toBe(false)
})
it('allows only the exact PersonnelObj identity lookup', () => {
  const query = {
    url: tokenRequest().url.replace('/oauth2.0/token','/cgi/crm/v2/data/query'),
    headers: { 'content-type': 'application/json', authorization: 'Bearer fixture-token', 'x-fs-ea': 'enterprise', 'x-fs-userid': '123' },
    body: JSON.stringify({
      convertUserId: false,
      data: {
        dataObjectApiName: 'PersonnelObj',
        search_query_info: {
          limit: 100,
          offset: 0,
          fieldProjection: ['_id','user_id','full_name','name','phone','employee_number','status','is_pause_login','life_status','is_deleted'],
          filters: [{ field_name: 'user_id', field_values: ['employee-open-id'], operator: 'EQ' }],
          orders: [],
        },
      },
    }),
  }
  expect(validRequest(query)).toBe(true)
  expect(validRequest({ ...query, body: query.body.replace('employee-open-id','other-user') })).toBe(true)
  expect(validRequest({ ...query, body: query.body.replace('"operator":"EQ"','"operator":"LIKE"') })).toBe(false)
  expect(validRequest({ ...query, body: query.body.replace('"field_name":"user_id"','"field_name":"name"') })).toBe(false)
  expect(validRequest({ ...query, body: query.body.replace('"phone"','"password"') })).toBe(false)
})
it('allows only exact read-only object metadata requests', () => {
  const headers = { 'content-type': 'application/json', authorization: 'Bearer fixture-token', 'x-fs-ea': 'enterprise', 'x-fs-userid': '123' }
  const list = { url: tokenRequest().url.replace('/oauth2.0/token','/cgi/crm/v2/object/list'), headers, body: '{}' }
  const describe = {
    url: tokenRequest().url.replace('/oauth2.0/token','/cgi/crm/v2/object/describe'),
    headers,
    body: JSON.stringify({ data: { apiName: 'ApprovalObj', includeDetail: false } }),
  }
  expect(validRequest(list)).toBe(true)
  expect(validRequest(describe)).toBe(true)
  expect(validRequest({ ...list, body: JSON.stringify({ page: 2 }) })).toBe(false)
  expect(validRequest({ ...describe, body: JSON.stringify({ data: { apiName: 'ApprovalObj', includeDetail: true } }) })).toBe(false)
  expect(validRequest({ ...describe, body: JSON.stringify({ data: { apiName: '../ApprovalObj', includeDetail: false } }) })).toBe(false)
  expect(validRequest({ ...describe, url: describe.url.replace('/object/describe','/object/create') })).toBe(false)
})
it('caps responses and never serializes provider exceptions', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('x'.repeat(MAX_RESPONSE_BYTES + 1)))
  expect(await executeRequest(tokenRequest(), fetcher)).toEqual({ error: 'INVALID_RESPONSE' })
  fetcher.mockRejectedValue(new Error('example-secret provider response'))
  expect(await executeRequest(tokenRequest(), fetcher)).toEqual({ error: 'NETWORK' })
  expect(validResult({ error: 'example-secret' })).toBe(false)
})
