// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { previewDirectory } from './client'
const credentials = { appId: 'FSAID_test', appSecret: 'test-only-secret', permanentCode: 'test-only-code', expectedEa: 'example', apiUserId: '123' }
const token = { errorCode: 0, appId: credentials.appId, ea: 'example', openUserId: 'FSCID_test', accessToken: 'test-token' }
const department = { _id: '100', name: '销售部', parent_id: [], status: 0 }
const employee = { _id: 'record1', user_id: '123', name: '测试员工', main_department: ['100'], status: '0', is_pause_login: false }
const page = (rows: unknown[], total = rows.length) => ({ errorCode: 0, data: { dataList: rows, total } })
function fixture(...values: unknown[]) { return vi.fn<typeof fetch>().mockImplementation(async () => Response.json(values.shift())) }

describe('Fxiaoke direct directory preview', () => {
  it('uses self-built app token and scoped OpenAPI headers, without MCP or writes', async () => {
    const request = fixture(token, page([department]), page([employee]))
    const result = await previewDirectory(credentials, request)
    expect(result).toMatchObject({ ea: 'example', applied: false, visibility: 'authorized_scope', employees: [{ id: '123', name: '测试员工' }] })
    expect(request.mock.calls.every(([url]) => String(url).startsWith('https://open.fxiaoke.com/'))).toBe(true)
    expect(request.mock.calls.every(([,init]) => init?.redirect === 'error' && init?.cache === 'no-store')).toBe(true)
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toMatchObject({ grantType: 'app_secret', appId: credentials.appId })
    expect(request.mock.calls[1][1]?.headers).toMatchObject({ authorization: 'Bearer test-token', 'x-fs-ea': 'example', 'x-fs-userid': '123' })
    expect(JSON.stringify(result)).not.toContain('test-token')
  })
  it('rejects wrong enterprise before querying any directory data', async () => {
    const request = fixture({ ...token, ea: 'another-enterprise' })
    await expect(previewDirectory(credentials, request)).rejects.toMatchObject({ code: 'TENANT_MISMATCH' })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('reads all pages rather than silently showing the first 100 records', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ ...department, _id: String(i) }))
    const request = fixture(token, page(rows, 101), page([department], 101), page([employee]))
    const result = await previewDirectory(credentials, request)
    expect(result.departments).toHaveLength(101)
    expect(JSON.parse(String(request.mock.calls[2][1]?.body)).data.search_query_info.offset).toBe(100)
  })
  it('rejects incomplete and changing snapshots', async () => {
    await expect(previewDirectory(credentials, fixture(token, page([department], 10)))).rejects.toMatchObject({ code: 'INCOMPLETE_DIRECTORY' })
    const rows = Array.from({ length: 100 }, (_, i) => ({ ...department, _id: String(i) }))
    await expect(previewDirectory(credentials, fixture(token, page(rows, 101), page([department], 102)))).rejects.toMatchObject({ code: 'INCOMPLETE_DIRECTORY' })
  })
  it('rejects duplicated employee identity and never matches by display name', async () => {
    await expect(previewDirectory(credentials, fixture(token, page([department]), page([employee, { ...employee, _id: 'record2' }])))).rejects.toMatchObject({ code: 'DUPLICATE_IDENTITY' })
    const result = await previewDirectory(credentials, fixture(token, page([department]), page([employee, { ...employee, _id: 'record2', user_id: '456' }])))
    expect(result.employees).toHaveLength(2)
  })
  it('labels empty reads as scoped results and never an applied organization', async () => {
    const result = await previewDirectory(credentials, fixture(token, page([]), page([])))
    expect(result.warnings.join('')).toContain('结果为空')
    expect(result.applied).toBe(false)
  })
  it('does not reflect upstream secrets in errors', async () => {
    await expect(previewDirectory(credentials, fixture({ errorCode: 20016, errorMessage: credentials.appSecret }))).rejects.toThrow('错误码 20016')
    await expect(previewDirectory(credentials, fixture({ errorCode: 20016, errorMessage: credentials.appSecret }))).rejects.not.toThrow(credentials.appSecret)
  })
})
