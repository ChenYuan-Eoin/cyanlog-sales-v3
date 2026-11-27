// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { discoverEnterprise, inspectObjectMetadata, previewDirectory, readEmployeeIdentity } from './client'
const credentials = { appId: 'FSAID_test', appSecret: 'test-only-secret', permanentCode: 'test-only-code', expectedEa: 'example', apiUserId: '123' }
const token = { errorCode: 0, appId: credentials.appId, ea: 'example', openUserId: 'FSCID_test', accessToken: 'test-token' }
const department = { _id: '100', name: '销售部', parent_id: [], status: 0 }
const employee = { _id: 'record1', user_id: '123', name: '测试员工', main_department: ['100'], vice_departments: [], status: '0', is_pause_login: false }
const page = (rows: unknown[], total = rows.length) => ({ errorCode: 0, data: { dataList: rows, total } })
function fixture(...values: unknown[]) { return vi.fn<typeof fetch>().mockImplementation(async () => Response.json(values.shift())) }

describe('Fxiaoke direct directory preview', () => {
  it('returns server-side enterprise identity fields while discarding the access token', async () => {
    const request = fixture(token)
    const result = await discoverEnterprise(credentials, request)
    expect(result).toEqual({ ea: 'example', corpId: token.openUserId })
    expect(JSON.stringify(result)).not.toContain('test-token')
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ appId: credentials.appId, appSecret: credentials.appSecret, permanentCode: credentials.permanentCode, grantType: 'app_secret' })
  })
  it('rejects a discovery response for a different app or with an invalid enterprise account', async () => {
    await expect(discoverEnterprise(credentials, fixture({ ...token, appId: 'other' }))).rejects.toMatchObject({ code: 'INVALID_TOKEN_RESPONSE' })
    await expect(discoverEnterprise(credentials, fixture({ ...token, ea: '' }))).rejects.toMatchObject({ code: 'INVALID_TOKEN_RESPONSE' })
  })
  it('reports safe network categories without exposing upstream errors', async () => {
    const networkError = new Error('sensitive upstream data', { cause: { code: 'ENOTFOUND' } })
    await expect(discoverEnterprise(credentials, vi.fn().mockRejectedValue(networkError))).rejects.toMatchObject({ code: 'PROVIDER_DNS' })
    await expect(discoverEnterprise(credentials, vi.fn().mockRejectedValue(networkError))).rejects.not.toThrow('sensitive upstream data')
    await expect(discoverEnterprise(credentials, vi.fn().mockRejectedValue(Object.assign(new Error('secret'), { name: 'TimeoutError' })))).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' })
  })
  it('uses self-built app token and scoped OpenAPI headers, without MCP or writes', async () => {
    const request = fixture(token, page([department]), page([employee]))
    const result = await previewDirectory(credentials, request)
    expect(result).toMatchObject({
      ea: 'example', applied: false, visibility: 'authorized_scope', complete: true,
      departments: [{ id: '100', status: 'active' }],
      employees: [{ id: '123', name: '测试员工', primaryDepartmentId: '100', status: 'active' }],
    })
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
    const request = fixture(token, page(rows, 101), page([department], 1), page([employee]))
    const result = await previewDirectory(credentials, request)
    expect(result.departments).toHaveLength(101)
    const first = JSON.parse(String(request.mock.calls[1][1]?.body))
    const next = JSON.parse(String(request.mock.calls[2][1]?.body))
    expect(first.returnTotalNum).toBe(1)
    expect(first.data.search_query_info).toMatchObject({
      offset: 0,
      filters: [],
      orders: [{ fieldName: '_id', isAsc: true }],
    })
    expect(next.returnTotalNum).toBe(1)
    expect(next.data.search_query_info).toMatchObject({
      offset: 0,
      filters: [{ field_name: '_id', field_values: ['99'], operator: 'GT' }],
      orders: [{ fieldName: '_id', isAsc: true }],
    })
  })
  it('uses the remaining filtered total across a five-page employee directory', async () => {
    const rows = Array.from({ length: 405 }, (_, i) => ({ ...employee, _id: `record-${i}`, user_id: String(i) }))
    const request = fixture(token, page([department]),
      ...[0, 100, 200, 300, 400].map(offset => page(rows.slice(offset, offset + 100), rows.length - offset)),
    )
    const result = await previewDirectory(credentials, request)
    expect(result.employees).toHaveLength(405)
    expect(result.complete).toBe(true)
    expect(request).toHaveBeenCalledTimes(7)
  })
  it.each([0, 2, 101])('rejects a cursor total inconsistent with the initial total: %s', async remaining => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ ...department, _id: String(i) }))
    await expect(previewDirectory(credentials, fixture(token, page(rows, 101), page([department], remaining))))
      .rejects.toMatchObject({ code: 'INCOMPLETE_DIRECTORY' })
  })
  it('rejects incomplete and changing snapshots', async () => {
    await expect(previewDirectory(credentials, fixture(token, page([department], 10)))).rejects.toMatchObject({ code: 'INCOMPLETE_DIRECTORY' })
    const rows = Array.from({ length: 100 }, (_, i) => ({ ...department, _id: String(i) }))
    await expect(previewDirectory(credentials, fixture(token, page(rows, 101), page([department], 102)))).rejects.toMatchObject({ code: 'INCOMPLETE_DIRECTORY' })
    await expect(previewDirectory(credentials, fixture(token, { errorCode: 0, data: { dataList: [department] } }))).rejects.toMatchObject({ code: 'INCOMPLETE_DIRECTORY' })
  })
  it('deduplicates identical personnel observations and never matches by display name', async () => {
    const one = await previewDirectory(credentials, fixture(token, page([department]), page([employee])))
    const repeated = await previewDirectory(credentials, fixture(token, page([department]), page([employee, { ...employee, _id: 'record2' }])))
    expect(repeated.employees).toEqual(one.employees)
    const result = await previewDirectory(credentials, fixture(token, page([department]), page([employee, { ...employee, _id: 'record2', user_id: '456' }])))
    expect(result.employees).toHaveLength(2)
  })
  it('merges compatible secondary links for the same stable employee across pages', async () => {
    const main = { ...employee, name: '测试员工', phone: '139-0000-0001', email: 'TEST@example.com', vice_departments: ['200'] }
    const filling = Array.from({ length: 99 }, (_, index) => ({ ...employee, _id: `filler-${index}`, user_id: `filler-${index}` }))
    const later = { ...main, _id: 'record-later', phone: '+86 13900000001', email: 'test@example.com', vice_departments: ['300'] }
    const departments = [department, { ...department, _id: '200' }, { ...department, _id: '300' }]
    const result = await previewDirectory(credentials, fixture(token, page(departments), page([main, ...filling], 101), page([later], 1)))
    expect(result.complete).toBe(true)
    expect(result.employees).toHaveLength(100)
    expect(result.employees.find(row => row.id === '123')).toMatchObject({
      primaryDepartmentId: '100', departmentIds: ['100', '200', '300'], phone: '+8613900000001', email: 'test@example.com',
    })
    expect(result.employees.find(row => row.id === '123')).not.toHaveProperty('sourceConflict')
  })
  it('isolates disagreements about primary assignment or profile and any competing phone claim', async () => {
    const departments = [department, { ...department, _id: '200' }]
    const observed = [
      { ...employee, phone: '13900000001' },
      { ...employee, _id: 'record2', phone: '13900000002' },
      { ...employee, _id: 'record3', user_id: '456', phone: '+8613900000002' },
      { ...employee, _id: 'record4', user_id: '789' },
      { ...employee, _id: 'record5', user_id: '789', main_department: ['200'] },
      { ...employee, _id: 'record6', user_id: '999', phone: '13900000003' },
    ]
    const result = await previewDirectory(credentials, fixture(token, page(departments), page(observed)))
    expect(result.complete).toBe(true)
    expect(result.employees).toMatchObject([
      { id: '123', sourceConflict: 'employee_profile', status: 'active', primaryDepartmentId: '100', departmentIds: ['100'], phone: null },
      { id: '456', sourceConflict: 'phone_claim', status: 'active', primaryDepartmentId: '100', departmentIds: ['100'], phone: null },
      { id: '789', sourceConflict: 'primary_department', primaryDepartmentId: null, departmentIds: ['100', '200'] },
      { id: '999', phone: '+8613900000003' },
    ])
    expect(result.employees[3]).not.toHaveProperty('sourceConflict')
    expect(result.warnings).toContain('3 位员工的纷享记录需要核对。')
    const missingDepartment = await previewDirectory(credentials, fixture(token, page([department]), page(observed)))
    expect(missingDepartment.complete).toBe(false)
  })
  it('leaves contradictory employment unknown even when the primary department agrees', async () => {
    const conflicting = await previewDirectory(credentials, fixture(token, page([department]), page([
      employee, { ...employee, _id: 'record2', status: '1' },
    ])))
    expect(conflicting.employees[0]).toMatchObject({
      sourceConflict: 'employee_profile', status: 'unknown', primaryDepartmentId: '100', departmentIds: ['100'],
    })
  })

  it('keeps a repeated raw cursor record a pagination error even when its personnel fields agree', async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({ ...employee, _id: `record-${index}`, user_id: `staff-${index}` }))
    const request = fixture(token, page([department]), page(first, 101), page([first[0]], 1))
    await expect(previewDirectory(credentials, request)).rejects.toMatchObject({ code: 'INCOMPLETE_DIRECTORY' })
  })
  it('uses main_department instead of record ownership and merges supplementary departments', async () => {
    const request = fixture(
      token,
      page([department, { ...department, _id: '200', name: '华东销售部' }]),
      page([{ ...employee, main_department: ['100'], data_own_department: ['200'], vice_departments: ['200'] }]),
    )
    const result = await previewDirectory(credentials, request)
    expect(result.complete).toBe(true)
    expect(result.employees[0]).toMatchObject({
      primaryDepartmentId: '100',
      departmentIds: ['100', '200'],
    })
  })
  it('fails closed when an employee has no explicit primary department', async () => {
    const missing = await previewDirectory(credentials, fixture(
      token,
      page([department]),
      page([{ ...employee, main_department: [], vice_departments: ['100'] }]),
    ))
    expect(missing.complete).toBe(false)
    expect(missing.employees[0].primaryDepartmentId).toBeNull()
    expect(missing.warnings.join('')).toContain('没有唯一的归属部门')
  })

  it('quarantines a single personnel row with multiple explicit primary departments', async () => {
    const ambiguous = await previewDirectory(credentials, fixture(
      token,
      page([department, { ...department, _id: '200', name: '华东销售部' }]),
      page([{ ...employee, main_department: ['100', '200'], status: '1' }, { ...employee, _id: 'record2', user_id: '456' }]),
    ))
    expect(ambiguous.complete).toBe(true)
    expect(ambiguous.employees[0]).toMatchObject({ sourceConflict: 'primary_department', primaryDepartmentId: null, status: 'unknown' })
    expect(ambiguous.employees[1]).not.toHaveProperty('sourceConflict')
    expect(ambiguous.warnings).toContain('1 位员工的纷享记录需要核对。')
  })
  it('normalizes documented Fxiaoke lifecycle values and blocks unknown statuses', async () => {
    const departments = [
      { ...department, _id: 'active', status: '0' },
      { ...department, _id: 'inactive', status: '1' },
      { ...department, _id: 'deleted', status: '2' },
    ]
    const employees = [
      { ...employee, _id: 'employee-active', user_id: 'active-user', main_department: ['active'], status: '0' },
      { ...employee, _id: 'employee-inactive', user_id: 'inactive-user', main_department: ['active'], status: '1' },
    ]
    const mapped = await previewDirectory(credentials, fixture(token, page(departments), page(employees)))
    expect(mapped.departments.map(item => item.status)).toEqual(['active', 'inactive', 'deleted'])
    expect(mapped.employees.map(item => item.status)).toEqual(['active', 'inactive'])
    expect(mapped.complete).toBe(true)

    const unknown = await previewDirectory(credentials, fixture(
      token,
      page([{ ...department, status: 'unexpected' }]),
      page([{ ...employee, status: 'unexpected', is_pause_login: null }]),
    ))
    expect(unknown.complete).toBe(false)
    expect(unknown.warnings.join('')).toContain('生命周期状态无法识别')
    expect(unknown.warnings.join('')).toContain('禁止登录状态未知')
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
  it('reads one verified employee profile by OAuth subject without using the system work number', async () => {
    const profile = {
      _id: 'record1',
      user_id: '1093',
      full_name: '测试员工',
      name: '测试员工昵称',
      phone: '13900000000',
      employee_number: 'E1001',
      status: '0',
      is_pause_login: false,
      life_status: '正常',
      is_deleted: false,
    }
    const request = fixture(token, page([profile]))
    await expect(readEmployeeIdentity(credentials, 'FSUID_employee', request)).resolves.toEqual({
      externalSubject: 'FSUID_employee',
      directoryUserId: '1093',
      phone: '13900000000',
      employeeNumber: 'E1001',
      displayName: '测试员工',
      status: 'active',
      loginDisabled: false,
      lifeStatus: '正常',
      deleted: false,
    })
    const body = JSON.parse(String(request.mock.calls[1][1]?.body))
    expect(body.convertUserId).toBe(true)
    const query = body.data.search_query_info
    expect(query.filters).toEqual([{ field_name: 'user_id', field_values: ['FSUID_employee'], operator: 'EQ' }])
    expect(query.fieldProjection).not.toContain('password')
    expect(JSON.stringify(request.mock.calls[1][1])).not.toContain('employee_number":"E1001')
    await expect(readEmployeeIdentity(credentials, 'FSUID_employee', fixture(
      token, page([{ ...profile, life_status: 'normal' }]),
    ))).resolves.toMatchObject({ directoryUserId: '1093', lifeStatus: 'normal' })
  })
  it('resolves the numeric directory ID from the same object when FSUID conversion also changes the response', async () => {
    const converted = { _id: 'record1', user_id: 'FSUID_employee', name: '测试员工', status: '0', is_pause_login: false }
    const numeric = { ...converted, user_id: '1093' }
    const request = fixture(token, page([converted]), page([numeric]))
    await expect(readEmployeeIdentity(credentials, 'FSUID_employee', request))
      .resolves.toMatchObject({ externalSubject: 'FSUID_employee', directoryUserId: '1093', status: 'active' })
    const followup = JSON.parse(String(request.mock.calls[2][1]?.body))
    expect(followup.convertUserId).toBe(false)
    expect(followup.data.search_query_info.filters)
      .toEqual([{ field_name: '_id', field_values: ['record1'], operator: 'EQ' }])
    await expect(readEmployeeIdentity(credentials, 'FSUID_employee', fixture(
      token, page([converted]), page([{ ...numeric, _id: 'record2' }]),
    ))).rejects.toMatchObject({ code: 'IDENTITY_PROFILE_MISMATCH', status: 409 })
  })
  it('fails closed for missing, ambiguous, mismatched or inactive provider profiles', async () => {
    const profile = { _id: 'record1', user_id: '1093', name: '测试员工', phone: '13900000000', employee_number: 'E1001', status: '0', is_pause_login: false, life_status: '正常', is_deleted: false }
    await expect(readEmployeeIdentity(credentials, 'employee-open-id', fixture(token, page([])))).rejects.toMatchObject({ code: 'IDENTITY_PROFILE_NOT_FOUND', status: 403 })
    await expect(readEmployeeIdentity(credentials, 'employee-open-id', fixture(token, page([profile, { ...profile, _id: 'record2' }])))).rejects.toMatchObject({ code: 'IDENTITY_PROFILE_AMBIGUOUS', status: 403 })
    await expect(readEmployeeIdentity(credentials, 'employee-open-id', fixture(token, page([{ ...profile, user_id: 'other-user' }])))).rejects.toMatchObject({ code: 'IDENTITY_PROFILE_MISMATCH', status: 409 })
    await expect(readEmployeeIdentity(credentials, 'employee-open-id', fixture(token, page([{ ...profile, is_pause_login: true }])))).rejects.toMatchObject({ code: 'EMPLOYEE_INACTIVE', status: 403 })
    await expect(readEmployeeIdentity(credentials, 'employee-open-id', fixture(token, page([{ ...profile, status: '1' }])))).rejects.toMatchObject({ code: 'EMPLOYEE_INACTIVE', status: 403 })
    await expect(readEmployeeIdentity(credentials, 'employee-open-id', fixture(token, page([{ ...profile, status: 'unexpected' }])))).rejects.toMatchObject({ code: 'EMPLOYEE_INACTIVE', status: 403 })
  })
  it.each([undefined, null, [], {}, { dataList: null }, { dataList: {} }])('rejects an unverifiable profile response using a fixed safe category: %o', async data => {
    await expect(readEmployeeIdentity(credentials, 'employee-open-id', fixture(token, { errorCode: 0, data })))
      .rejects.toMatchObject({ code: 'IDENTITY_PROFILE_RESPONSE_INVALID', status: 403 })
  })
})

describe('Fxiaoke read-only object metadata', () => {
  it('lists object schema without exposing provider credentials or tokens', async () => {
    const request = fixture(token, {
      errorCode: 0,
      data: { objects: [
        { describeApiName: 'ApprovalObj', describeDisplayName: '寄件审批', defineType: 'custom', isActive: true },
        { describeApiName: 'AccountObj', describeDisplayName: '客户', defineType: 'standard', isActive: true },
      ] },
    })
    const result = await inspectObjectMetadata(credentials, { operation: 'list' }, request)

    expect(result).toEqual({
      ea: 'example',
      operation: 'list',
      objects: [
        { apiName: 'AccountObj', displayName: '客户', defineType: 'standard', active: true },
        { apiName: 'ApprovalObj', displayName: '寄件审批', defineType: 'custom', active: true },
      ],
    })
    expect(request.mock.calls[1][1]?.headers).toMatchObject({
      authorization: 'Bearer test-token',
      'x-fs-ea': 'example',
      'x-fs-userid': '123',
    })
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({})
    expect(JSON.stringify(result)).not.toContain('test-token')
    expect(JSON.stringify(result)).not.toContain(credentials.appSecret)
  })

  it('reads one exact object description with includeDetail disabled', async () => {
    const request = fixture(token, {
      errorCode: 0,
      data: { describe: {
        describeApiName: 'ApprovalObj',
        describeDisplayName: '寄件审批',
        defineType: 'custom',
        isActive: true,
        fields: [{ apiName: 'recipient_name__c', label: '收件人', type: 'text' }],
      } },
    })
    const result = await inspectObjectMetadata(credentials, { operation: 'describe', objectApiName: 'ApprovalObj' }, request)

    expect(result).toMatchObject({
      ea: 'example',
      operation: 'describe',
      object: { apiName: 'ApprovalObj', displayName: '寄件审批', active: true },
      fields: [{ apiName: 'recipient_name__c', label: '收件人' }],
    })
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toEqual({
      data: { apiName: 'ApprovalObj', includeDetail: false },
    })
  })

  it('rejects a different tenant before object metadata is requested', async () => {
    const request = fixture({ ...token, ea: 'another-enterprise' })
    await expect(inspectObjectMetadata(credentials, { operation: 'list' }, request))
      .rejects.toMatchObject({ code: 'TENANT_MISMATCH' })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('does not reflect provider error text or credential values', async () => {
    const request = fixture({ errorCode: 20016, errorMessage: credentials.appSecret })
    await expect(inspectObjectMetadata(credentials, { operation: 'list' }, request))
      .rejects.toThrow('错误码 20016')
    await expect(inspectObjectMetadata(credentials, { operation: 'list' }, fixture({ errorCode: 20016, errorMessage: credentials.appSecret })))
      .rejects.not.toThrow(credentials.appSecret)
  })
})
