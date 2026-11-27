// REQ: F003 / WP91. Official self-built app OAuth and paginated CRM directory reads.
// https://developer.fxiaoke.com/openapi_v2/start/auth/app-info.html
// https://developer.fxiaoke.com/openapi_v2/start/example/public.html
import { randomUUID } from 'node:crypto'
import {
  FxiaokeError,
  normalizeFxiaokeDepartmentStatus,
  normalizeFxiaokePersonnelStatus,
  normalizeIdentityPhone,
  type Credentials,
  type DirectoryEmployee,
  type DirectoryPreview,
  type VerifiedEmployeeIdentity,
} from './contracts'

const ORIGIN = 'https://open.fxiaoke.com'
const LIMIT = 100
const MAX_RECORDS = 5000
type Row = Record<string, unknown>
function object(value: unknown): Row {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FxiaokeError('INVALID_RESPONSE', '纷享返回的数据格式异常，本次预览未完成。', 502)
  return value as Row
}
function id(value: unknown): string {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value)
  throw new FxiaokeError('INVALID_RESPONSE', '纷享记录缺少稳定标识，不能用于组织同步。', 502)
}
function ids(value: unknown): string[] {
  if (value == null) return []
  if (!Array.isArray(value)) throw new FxiaokeError('INVALID_RESPONSE', '纷享部门关系格式异常，不能用于组织同步。', 502)
  return value.map(id)
}
function name(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new FxiaokeError('INVALID_RESPONSE', '纷享记录缺少名称，本次预览未完成。', 502)
  return value.trim()
}
function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readPersonnelRow(row: Row): DirectoryEmployee {
  const primaryDepartmentIds = [...new Set(ids(row.main_department))]
  const phone = optionalText(row.phone)
  return {
    id: id(row.user_id),
    name: name(row.name),
    departmentIds: [...new Set([...primaryDepartmentIds, ...ids(row.vice_departments)])].sort(),
    // PersonnelObj main_department is the employee primary department;
    // data_own_department controls record ownership and is not a membership.
    primaryDepartmentId: primaryDepartmentIds.length === 1 ? primaryDepartmentIds[0] : null,
    status: normalizeFxiaokePersonnelStatus(row.status),
    loginDisabled: typeof row.is_pause_login === 'boolean' ? row.is_pause_login : null,
    employeeNumber: optionalText(row.employee_number),
    email: optionalText(row.email)?.toLowerCase() ?? null,
    phone: normalizeIdentityPhone(phone) ?? phone,
    ...(primaryDepartmentIds.length > 1 ? { sourceConflict: 'primary_department' } : {}),
  }
}

function observedValues(values: (string | null)[]) {
  return [...new Set(values.filter(value => value !== null))].sort()
}

function groupPersonnelRows(rows: Row[]): DirectoryEmployee[] {
  const byIdentity = new Map<string, DirectoryEmployee[]>()
  for (const row of rows) {
    const employee = readPersonnelRow(row)
    const records = byIdentity.get(employee.id) ?? []
    records.push(employee)
    byIdentity.set(employee.id, records)
  }

  const disputedPhones = new Set<string>()
  const employees = [...byIdentity.values()].map<DirectoryEmployee>(records => {
    const first = records[0]
    if (records.length === 1 && !first.sourceConflict) return first

    const departmentIds = [...new Set(records.flatMap(record => record.departmentIds))].sort()
    const primaries = new Set(records.map(record => record.primaryDepartmentId))
    const primaryConflict = primaries.size > 1 || records.some(record => record.sourceConflict === 'primary_department')
    const names = observedValues(records.map(record => record.name))
    const statuses = new Set(records.map(record => record.status))
    const loginStates = new Set(records.map(record => record.loginDisabled))
    const employeeNumbers = observedValues(records.map(record => record.employeeNumber))
    const emails = observedValues(records.map(record => record.email))
    const phones = observedValues(records.map(record => record.phone))
    const profileConflict = [names.length, statuses.size, loginStates.size, employeeNumbers.length, emails.length, phones.length]
      .some(count => count > 1)

    if (!primaryConflict && !profileConflict) {
      return { ...first, departmentIds, employeeNumber: employeeNumbers[0] ?? null, email: emails[0] ?? null, phone: phones[0] ?? null }
    }

    // No competing contact data leaves the grouping step. Other identities
    // claiming any of these phones also require review before they can be used.
    for (const candidate of phones) {
      const number = normalizeIdentityPhone(candidate)
      if (number) disputedPhones.add(number)
    }
    const sourceConflict: DirectoryEmployee['sourceConflict'] = primaryConflict ? 'primary_department' : 'employee_profile'
    return {
      ...first, name: names[0], departmentIds,
      primaryDepartmentId: primaryConflict ? null : first.primaryDepartmentId,
      status: primaryConflict || statuses.size > 1 ? 'unknown' : first.status,
      loginDisabled: null, employeeNumber: null, email: null, phone: null, sourceConflict,
    }
  })

  return employees.map(employee => {
    const phone = normalizeIdentityPhone(employee.phone)
    if (!employee.sourceConflict && phone && disputedPhones.has(phone)) {
      return { ...employee, loginDisabled: null, phone: null, sourceConflict: 'phone_claim' }
    }
    return employee
  })
}

export type FxiaokeObjectSummary = {
  apiName: string
  displayName: string
  defineType: string | null
  active: boolean | null
}

export type FxiaokeObjectMetadataResult =
  | { ea: string; operation: 'list'; objects: FxiaokeObjectSummary[] }
  | { ea: string; operation: 'describe'; object: FxiaokeObjectSummary; fields: Row[] }

function metadataText(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function metadataBoolean(row: Row, keys: string[]) {
  for (const key of keys) {
    const value = row[key]
    if (typeof value === 'boolean') return value
  }
  return null
}

function objectSummary(value: unknown): FxiaokeObjectSummary {
  const row = object(value)
  const apiName = metadataText(row, ['describeApiName', 'apiName', 'objectApiName'])
  if (!apiName || !/^[A-Za-z][A-Za-z0-9_]*$/.test(apiName)) {
    throw new FxiaokeError('INVALID_RESPONSE', '纷享对象元数据缺少稳定 API 名称。', 502)
  }
  return {
    apiName,
    displayName: metadataText(row, ['describeDisplayName', 'displayName', 'label', 'name']) || apiName,
    defineType: metadataText(row, ['defineType', 'type']),
    active: metadataBoolean(row, ['isActive', 'active']),
  }
}

// Read-only metadata inspection for administrator-controlled integration setup.
// The result contains schema only; provider tokens and credentials never leave this function.
export async function inspectObjectMetadata(
  credentials: Credentials,
  input: { operation: 'list' } | { operation: 'describe'; objectApiName: string },
  request: typeof fetch = fetch,
): Promise<FxiaokeObjectMetadataResult> {
  const signal = AbortSignal.timeout(30_000)
  async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    let response: Response
    try {
      response = await request(`${ORIGIN}${path}?thirdTraceId=${randomUUID()}`, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal,
        headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
      })
    } catch (error) {
      throw connectionFailure(error)
    }
    if (!response.ok) throw new FxiaokeError('PROVIDER_HTTP_ERROR', `纷享接口返回 HTTP ${response.status}，元数据读取未完成。`, 502)
    let data: Row
    try { data = object(await response.json()) } catch { throw new FxiaokeError('INVALID_RESPONSE', '纷享接口没有返回有效元数据。', 502) }
    if (data.errorCode !== 0) {
      const code = Number.isSafeInteger(data.errorCode) ? String(data.errorCode) : '未知'
      throw new FxiaokeError('PROVIDER_REJECTED', `纷享拒绝读取对象元数据（错误码 ${code}）。请核对应用权限与固定出口白名单。`, 502)
    }
    return data
  }

  const token = await post('/oauth2.0/token', {
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    permanentCode: credentials.permanentCode,
    grantType: 'app_secret',
  })
  if (token.ea !== credentials.expectedEa || token.appId !== credentials.appId) {
    throw new FxiaokeError('TENANT_MISMATCH', '授权返回的企业或应用与配置不一致。', 409)
  }
  if (typeof token.accessToken !== 'string' || !token.accessToken) {
    throw new FxiaokeError('INVALID_TOKEN_RESPONSE', '纷享未返回有效的企业授权信息。', 502)
  }
  const headers = {
    authorization: `Bearer ${token.accessToken}`,
    'x-fs-ea': credentials.expectedEa,
    'x-fs-userid': credentials.apiUserId,
  }

  if (input.operation === 'list') {
    const response = await post('/cgi/crm/v2/object/list', {}, headers)
    const data = object(response.data)
    if (!Array.isArray(data.objects)) {
      throw new FxiaokeError('INVALID_RESPONSE', '纷享对象目录缺少 objects 列表。', 502)
    }
    return {
      ea: credentials.expectedEa,
      operation: 'list',
      objects: data.objects.map(objectSummary).sort((a, b) => a.apiName.localeCompare(b.apiName, 'en')),
    }
  }

  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(input.objectApiName)) {
    throw new FxiaokeError('INVALID_INPUT', '业务对象 API 名称格式无效。', 400)
  }
  const response = await post('/cgi/crm/v2/object/describe', {
    data: { apiName: input.objectApiName, includeDetail: false },
  }, headers)
  const data = object(response.data)
  const describe = object(data.describe)
  if (!Array.isArray(describe.fields)) {
    throw new FxiaokeError('INVALID_RESPONSE', '纷享对象描述缺少 fields 列表。', 502)
  }
  return {
    ea: credentials.expectedEa,
    operation: 'describe',
    object: objectSummary(describe),
    fields: describe.fields.map(object),
  }
}

// Classify known transport failures without returning upstream error text, URLs or credentials.
function connectionFailure(error: unknown): FxiaokeError {
  if (error instanceof FxiaokeError) return error
  const err = error instanceof Error ? error : null
  const cause = err?.cause && typeof err.cause === 'object' ? err.cause as { code?: unknown; errors?: unknown } : null
  const causes = [err, cause, ...(Array.isArray(cause?.errors) ? cause.errors : [])]
  const codes = causes.flatMap(item => item && typeof item === 'object' && 'code' in item && typeof item.code === 'string' ? [item.code] : [])
  if (codes.some(code => ['ENOTFOUND', 'EAI_AGAIN'].includes(code))) return new FxiaokeError('PROVIDER_DNS', '系统无法解析纷享服务地址（DNS），请联系系统管理员排查。', 502)
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError' || codes.some(code => ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code))) return new FxiaokeError('PROVIDER_TIMEOUT', '系统连接纷享超时，请联系系统管理员检查网络连通性。', 502)
  if (codes.some(code => ['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(code))) return new FxiaokeError('PROVIDER_TLS', '系统无法验证纷享的 HTTPS 证书，请联系系统管理员排查。', 502)
  if (codes.some(code => ['ECONNRESET', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'UND_ERR_SOCKET'].includes(code))) return new FxiaokeError('PROVIDER_CONNECTION', '系统连接纷享时被拒绝或中断，请联系系统管理员排查网络。', 502)
  return new FxiaokeError('PROVIDER_UNREACHABLE', '系统未能连接纷享，请联系系统管理员检查网络连接。', 502)
}

export async function previewDirectory(credentials: Credentials, request: typeof fetch = fetch): Promise<DirectoryPreview> {
  const signal = AbortSignal.timeout(45_000)
  async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    let response: Response
    try {
      response = await request(`${ORIGIN}${path}?thirdTraceId=${randomUUID()}`, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal,
        headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
      })
    } catch (error) {
      throw connectionFailure(error)
    }
    if (!response.ok) throw new FxiaokeError('PROVIDER_HTTP_ERROR', `纷享接口返回 HTTP ${response.status}，本次预览未完成。`, 502)
    let data: Row
    try { data = object(await response.json()) } catch { throw new FxiaokeError('INVALID_RESPONSE', '纷享接口没有返回有效数据。', 502) }
    if (data.errorCode !== 0) {
      // Never echo provider messages: they may contain credentials or PII.
      const code = Number.isSafeInteger(data.errorCode) ? String(data.errorCode) : '未知'
      throw new FxiaokeError('PROVIDER_REJECTED', `纷享拒绝请求（错误码 ${code}）。请核对应用凭据、员工读取权限、IP 白名单和 OpenAPI 权益。`, 502)
    }
    return data
  }
  const token = await post('/oauth2.0/token', {
    appId: credentials.appId, appSecret: credentials.appSecret,
    permanentCode: credentials.permanentCode, grantType: 'app_secret',
  })
  if (token.ea !== credentials.expectedEa || token.appId !== credentials.appId) {
    throw new FxiaokeError('TENANT_MISMATCH', '授权返回的企业或应用与配置不一致，请核对企业标识和 AppID。', 409)
  }
  if (typeof token.accessToken !== 'string' || !token.accessToken || typeof token.openUserId !== 'string' || !token.openUserId.startsWith('FSCID_')) {
    throw new FxiaokeError('INVALID_TOKEN_RESPONSE', '纷享未返回有效的企业授权信息。', 502)
  }
  const headers = { authorization: `Bearer ${token.accessToken}`, 'x-fs-ea': credentials.expectedEa, 'x-fs-userid': credentials.apiUserId }
  async function readAll(apiName: string, fields: string[]): Promise<Row[]> {
    const result: Row[] = []; const seen = new Set<string>(); let total: number | null = null
    let cursor: string | null = null
    for (let pageNumber = 0; pageNumber <= Math.ceil(MAX_RECORDS / LIMIT); pageNumber += 1) {
      const filters = cursor === null
        ? []
        : [{ field_name: '_id', field_values: [cursor], operator: 'GT' }]
      const response = await post('/cgi/crm/v2/data/query', {
        convertUserId: false,
        returnTotalNum: 1,
        data: { dataObjectApiName: apiName, search_query_info: {
          limit: LIMIT,
          offset: 0,
          fieldProjection: fields,
          filters,
          orders: [{ fieldName: '_id', isAsc: true }],
        } },
      }, headers)
      const page = object(response.data)
      // `total` counts the current query's matches. With an _id > cursor
      // filter it is the remaining count, not the first page's directory total.
      // Keep the first total frozen and reject additions/deletions that make
      // the remaining count disagree with the records already collected.
      if (!Array.isArray(page.dataList) || !Number.isSafeInteger(page.total) || Number(page.total) < 0 || Number(page.total) > MAX_RECORDS || (total !== null && result.length + Number(page.total) !== total)) {
        throw new FxiaokeError('INCOMPLETE_DIRECTORY', '通讯录数量变化、超出预览上限或分页信息不完整，请缩小读取范围后重试。', 409)
      }
      total ??= Number(page.total)
      for (const raw of page.dataList) {
        const row = object(raw); const recordId = id(row._id)
        if (seen.has(recordId)) throw new FxiaokeError('INCOMPLETE_DIRECTORY', '通讯录分页出现重复记录，请稍后重试。', 409)
        seen.add(recordId); result.push(row)
      }
      if (result.length === total) return result
      if (result.length > total || page.dataList.length !== LIMIT) throw new FxiaokeError('INCOMPLETE_DIRECTORY', '通讯录分页未读取完整，不能将部分结果用于同步。', 409)
      const nextCursor = id(object(page.dataList[page.dataList.length - 1])._id)
      if (nextCursor === cursor) throw new FxiaokeError('INCOMPLETE_DIRECTORY', '通讯录分页游标没有前进，不能将部分结果用于同步。', 409)
      cursor = nextCursor
    }
    throw new FxiaokeError('INCOMPLETE_DIRECTORY', '通讯录超出本次预览上限。', 409)
  }
  const departmentRows = await readAll('DepartmentObj', ['_id', 'name', 'parent_id', 'status'])
  const employeeRows = await readAll('PersonnelObj', [
    '_id', 'user_id', 'name', 'main_department', 'vice_departments',
    'status', 'is_pause_login', 'employee_number', 'email', 'phone',
  ])
  const departments = departmentRows.map(row => ({
    id: id(row._id),
    name: name(row.name),
    parentId: ids(row.parent_id)[0] || null,
    status: normalizeFxiaokeDepartmentStatus(row.status),
  }))
  const employees = groupPersonnelRows(employeeRows)
  const consistentEmployees = employees.filter(item => !item.sourceConflict)
  const departmentIds = new Set(departments.map(item => item.id))
  const missingDepartmentParents = departments.some(item => item.parentId && !departmentIds.has(item.parentId))
  const employeesMissingDepartments = employees.some(item => item.departmentIds.some(departmentId => !departmentIds.has(departmentId)))
  const employeesWithoutDepartments = consistentEmployees.filter(item => item.departmentIds.length === 0)
  const employeesWithoutPrimaryDepartments = consistentEmployees.filter(item => !item.primaryDepartmentId)
  const unknownDepartmentStatuses = departments.filter(item => item.status === 'unknown')
  const unknownEmployeeStatuses = consistentEmployees.filter(item => item.status === 'unknown')
  const unknownLoginStates = consistentEmployees.filter(item => item.loginDisabled === null)
  const complete = departments.length > 0
    && employees.length > 0
    && !missingDepartmentParents
    && !employeesMissingDepartments
    && employeesWithoutDepartments.length === 0
    && employeesWithoutPrimaryDepartments.length === 0
    && unknownDepartmentStatuses.length === 0
    && unknownEmployeeStatuses.length === 0
  const warnings = [
    '仅显示该员工有权读取的通讯录；分页读取完成不代表拥有全公司读取权限，不能据此单独证明目录完整。',
    '本次为只读检查，尚未同步成员、授予寄件权限或切换主来源。',
  ]
  if (!departments.length || !employees.length) warnings.push('部门或员工结果为空，请先核对读取范围，不可据此停用系统成员。')
  if (missingDepartmentParents) warnings.push('部分部门的上级不在可读取范围内，需补齐权限后再生成切源计划。')
  if (employeesMissingDepartments) warnings.push('部分员工的部门关系不在可读取范围内，需补齐权限后再生成切源计划。')
  if (employeesWithoutDepartments.length) warnings.push(`${employeesWithoutDepartments.length} 位员工没有部门关系，目录关系不完整。`)
  if (employeesWithoutPrimaryDepartments.length) warnings.push(`${employeesWithoutPrimaryDepartments.length} 位员工没有唯一的归属部门；禁止从附属部门或数组顺序猜测主属关系。`)
  if (unknownDepartmentStatuses.length) warnings.push(`${unknownDepartmentStatuses.length} 个部门的生命周期状态无法识别，切源将整批阻断。`)
  if (unknownEmployeeStatuses.length) warnings.push(`${unknownEmployeeStatuses.length} 位员工的在职状态无法识别，切源将整批阻断。`)
  if (unknownLoginStates.length) warnings.push(`${unknownLoginStates.length} 位员工的禁止登录状态未知；这些成员不能获得寄件权限。`)
  if (consistentEmployees.length !== employees.length) warnings.push(`${employees.length - consistentEmployees.length} 位员工的纷享记录需要核对。`)
  return { ea: credentials.expectedEa, corpId: token.openUserId, checkedAt: new Date().toISOString(), departments, employees, complete, warnings, visibility: 'authorized_scope', applied: false }
}

/**
 * The documented PersonnelObj filter accepts the OAuth openUserId (FSUID),
 * while the projected user_id is the numeric directory ID already synchronized
 * into ICU. Neither phone nor employee number is used to bind accounts.
 */
export async function readEmployeeIdentity(
  credentials: Credentials,
  externalSubject: string,
  request: typeof fetch = fetch,
): Promise<VerifiedEmployeeIdentity> {
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(externalSubject)) {
    throw new FxiaokeError('INVALID_IDENTITY', '纷享员工身份标识无效。', 403)
  }

  async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    let response: Response
    try {
      response = await request(`${ORIGIN}${path}?thirdTraceId=${randomUUID()}`, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.timeout(30_000),
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      })
    } catch (error) {
      throw connectionFailure(error)
    }
    if (!response.ok) {
      throw new FxiaokeError('PROVIDER_HTTP_ERROR', `纷享人员接口返回 HTTP ${response.status}。`, 502)
    }
    let data: Row
    try {
      data = object(await response.json())
    } catch {
      throw new FxiaokeError('INVALID_RESPONSE', '纷享人员接口没有返回有效数据。', 502)
    }
    if (data.errorCode !== 0) {
      const code = Number.isSafeInteger(data.errorCode) ? String(data.errorCode) : '未知'
      throw new FxiaokeError('PROVIDER_REJECTED', `纷享拒绝读取当前员工资料（错误码 ${code}）。`, 502)
    }
    return data
  }

  const token = await post('/oauth2.0/token', {
    appId: credentials.appId,
    appSecret: credentials.appSecret,
    permanentCode: credentials.permanentCode,
    grantType: 'app_secret',
  })
  if (token.ea !== credentials.expectedEa || token.appId !== credentials.appId) {
    throw new FxiaokeError('TENANT_MISMATCH', '授权返回的企业或应用与配置不一致。', 409)
  }
  if (
    typeof token.accessToken !== 'string'
    || !token.accessToken
    || typeof token.openUserId !== 'string'
    || !token.openUserId.startsWith('FSCID_')
  ) {
    throw new FxiaokeError('INVALID_TOKEN_RESPONSE', '纷享未返回有效的企业授权信息。', 502)
  }

  async function queryPersonnel(fieldName: 'user_id' | '_id', value: string, convertUserId: boolean) {
    const response = await post('/cgi/crm/v2/data/query', {
      convertUserId,
      data: {
        dataObjectApiName: 'PersonnelObj',
        search_query_info: {
          limit: 100,
          offset: 0,
          fieldProjection: [
            '_id',
            'user_id',
            'full_name',
            'name',
            'phone',
            'employee_number',
            'status',
            'is_pause_login',
            'life_status',
            'is_deleted',
          ],
          filters: [{
            field_name: fieldName,
            field_values: [value],
            operator: 'EQ',
          }],
          orders: [],
        },
      },
    }, {
      authorization: `Bearer ${token.accessToken}`,
      'x-fs-ea': credentials.expectedEa,
      'x-fs-userid': credentials.apiUserId,
    })
    const page = response.data
    if (!page || typeof page !== 'object' || Array.isArray(page) || !Array.isArray((page as Row).dataList)) {
      throw new FxiaokeError(
        'IDENTITY_PROFILE_RESPONSE_INVALID',
        '当前纷享员工资料返回格式无法验证，登录已拒绝。',
        403,
      )
    }
    return (page as Row).dataList as unknown[]
  }

  // New OpenAPI headers interpret employee IDs as numeric by default. The OAuth
  // subject is an FSUID, so the filter must explicitly enable conversion.
  const rows = await queryPersonnel('user_id', externalSubject, externalSubject.startsWith('FSUID_'))
  if (rows.length === 0) {
    throw new FxiaokeError('IDENTITY_PROFILE_NOT_FOUND', '未找到当前纷享员工的唯一企业资料，登录已拒绝。', 403)
  }
  if (rows.length !== 1) {
    throw new FxiaokeError('IDENTITY_PROFILE_AMBIGUOUS', '当前纷享员工的企业资料不唯一，登录已拒绝。', 403)
  }
  let row = object(rows[0])
  let directoryUserId = id(row.user_id)
  if (directoryUserId.startsWith('FSUID_') && directoryUserId === externalSubject) {
    // If the converted response also uses FSUID, read that same object again
    // without conversion to obtain the numeric ID used by the synced directory.
    const objectDataId = id(row._id)
    const numericRows = await queryPersonnel('_id', objectDataId, false)
    if (numericRows.length !== 1) {
      throw new FxiaokeError('IDENTITY_PROFILE_MISMATCH', '纷享员工资料与登录身份不一致。', 409)
    }
    row = object(numericRows[0])
    if (id(row._id) !== objectDataId) {
      throw new FxiaokeError('IDENTITY_PROFILE_MISMATCH', '纷享员工资料与登录身份不一致。', 409)
    }
    directoryUserId = id(row.user_id)
  }
  if (!/^\d+$/.test(directoryUserId)) {
    throw new FxiaokeError('IDENTITY_PROFILE_MISMATCH', '纷享员工资料与登录身份不一致。', 409)
  }

  const lifeStatus = optionalText(row.life_status)
  const profile: VerifiedEmployeeIdentity = {
    externalSubject,
    directoryUserId,
    phone: optionalText(row.phone),
    employeeNumber: optionalText(row.employee_number),
    displayName: optionalText(row.full_name) || name(row.name),
    status: normalizeFxiaokePersonnelStatus(row.status),
    loginDisabled: typeof row.is_pause_login === 'boolean' ? row.is_pause_login : null,
    lifeStatus,
    deleted: row.is_deleted === true,
  }
  if (
    profile.deleted
    || profile.loginDisabled === true
    || profile.status !== 'active'
    || (profile.lifeStatus && !['正常', 'normal'].includes(profile.lifeStatus.toLowerCase()))
  ) {
    throw new FxiaokeError('EMPLOYEE_INACTIVE', '当前纷享员工已停用、离职或不可登录。', 403)
  }
  return profile
}

// Only returns the provider's enterprise account; tokens and corp identifiers remain server-side.
export async function discoverEnterprise(credentials: Pick<Credentials, 'appId' | 'appSecret' | 'permanentCode'>, request: typeof fetch = fetch): Promise<{ ea: string; corpId: string }> {
  let response: Response
  try {
    response = await request(`${ORIGIN}/oauth2.0/token?thirdTraceId=${randomUUID()}`, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: credentials.appId, appSecret: credentials.appSecret, permanentCode: credentials.permanentCode, grantType: 'app_secret' }),
    })
  } catch (error) {
    throw connectionFailure(error)
  }
  if (!response.ok) throw new FxiaokeError('PROVIDER_HTTP_ERROR', `纷享接口返回 HTTP ${response.status}，应用连接验证未完成。`, 502)
  let data: Row
  try { data = object(await response.json()) } catch { throw new FxiaokeError('INVALID_RESPONSE', '纷享接口没有返回有效数据。', 502) }
  if (data.errorCode !== 0) {
    const code = Number.isSafeInteger(data.errorCode) ? String(data.errorCode) : '未知'
    throw new FxiaokeError('PROVIDER_REJECTED', `纷享拒绝请求（错误码 ${code}）。请核对应用凭据、IP 白名单和 OpenAPI 权益。`, 502)
  }
  if (data.appId !== credentials.appId || typeof data.ea !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.ea) || typeof data.accessToken !== 'string' || !data.accessToken || typeof data.openUserId !== 'string' || !data.openUserId.startsWith('FSCID_')) {
    throw new FxiaokeError('INVALID_TOKEN_RESPONSE', '纷享未返回有效的企业授权信息，请检查应用配置。', 502)
  }
  return { ea: data.ea, corpId: data.openUserId }
}
