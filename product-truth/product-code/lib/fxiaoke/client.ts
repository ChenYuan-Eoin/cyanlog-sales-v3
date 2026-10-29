// REQ: F003 / WP91. Official self-built app OAuth and paginated CRM directory reads.
// https://developer.fxiaoke.com/openapi_v2/start/auth/app-info.html
// https://developer.fxiaoke.com/openapi_v2/start/example/public.html
import { randomUUID } from 'node:crypto'
import { FxiaokeError, type Credentials, type DirectoryPreview, type VerifiedEmployeeIdentity } from './contracts'

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
function status(value: unknown) { return typeof value === 'string' || typeof value === 'number' ? String(value) : 'unknown' }
function optionalText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
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
    for (let offset = 0; offset <= MAX_RECORDS; offset += LIMIT) {
      const response = await post('/cgi/crm/v2/data/query', {
        convertUserId: false, data: { dataObjectApiName: apiName, search_query_info: {
          limit: LIMIT, offset, fieldProjection: fields, filters: [], orders: [],
        } },
      }, headers)
      const page = object(response.data)
      if (!Array.isArray(page.dataList) || !Number.isSafeInteger(page.total) || Number(page.total) < 0 || Number(page.total) > MAX_RECORDS || (total !== null && page.total !== total)) {
        throw new FxiaokeError('INCOMPLETE_DIRECTORY', '通讯录数量变化、超出预览上限或分页信息不完整，请缩小读取范围后重试。', 409)
      }
      total = Number(page.total)
      for (const raw of page.dataList) {
        const row = object(raw); const recordId = id(row._id)
        if (seen.has(recordId)) throw new FxiaokeError('INCOMPLETE_DIRECTORY', '通讯录分页出现重复记录，请稍后重试。', 409)
        seen.add(recordId); result.push(row)
      }
      if (result.length === total) return result
      if (result.length > total || page.dataList.length !== LIMIT) throw new FxiaokeError('INCOMPLETE_DIRECTORY', '通讯录分页未读取完整，不能将部分结果用于同步。', 409)
    }
    throw new FxiaokeError('INCOMPLETE_DIRECTORY', '通讯录超出本次预览上限。', 409)
  }
  const departmentRows = await readAll('DepartmentObj', ['_id', 'name', 'parent_id', 'status'])
  const employeeRows = await readAll('PersonnelObj', ['_id', 'user_id', 'name', 'main_department', 'status', 'is_pause_login'])
  const departments = departmentRows.map(row => ({ id: id(row._id), name: name(row.name), parentId: ids(row.parent_id)[0] || null, status: status(row.status) }))
  const employees = employeeRows.map(row => ({ id: id(row.user_id), name: name(row.name), departmentIds: ids(row.main_department), status: status(row.status), loginDisabled: typeof row.is_pause_login === 'boolean' ? row.is_pause_login : null }))
  if (new Set(employees.map(item => item.id)).size !== employees.length) throw new FxiaokeError('DUPLICATE_IDENTITY', '多个人员记录对应同一员工 ID，需先处理纷享人员数据。', 409)
  const departmentIds = new Set(departments.map(item => item.id))
  const warnings = ['仅显示该员工有权读取的通讯录；分页读取完成不代表拥有全公司读取权限。', '本次为只读预览，尚未同步成员、授予寄件权限或切换主来源。']
  if (!departments.length || !employees.length) warnings.push('部门或员工结果为空，请先核对读取范围，不可据此停用系统成员。')
  if (employees.some(item => item.departmentIds.some(departmentId => !departmentIds.has(departmentId)))) warnings.push('部分员工的主属部门不在可读取范围内，需补齐权限后再同步。')
  return { ea: credentials.expectedEa, corpId: token.openUserId, checkedAt: new Date().toISOString(), departments, employees, warnings, visibility: 'authorized_scope', applied: false }
}

/**
 * Reads the provider profile for the already-authenticated OAuth subject.
 * openUserId is only a provider lookup key here; it is never compared with the
 * system work number. PersonnelObj.phone is a provider-returned value, not an
 * independent verification claim. The identity resolver still requires one
 * canonical phone match before persisting a new mapping.
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

  const response = await post('/cgi/crm/v2/data/query', {
    convertUserId: false,
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
          field_name: 'user_id',
          field_values: [externalSubject],
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

  const page = object(response.data)
  if (!Array.isArray(page.dataList) || page.dataList.length !== 1) {
    throw new FxiaokeError(
      'IDENTITY_PROFILE_UNAVAILABLE',
      page.dataList && Array.isArray(page.dataList) && page.dataList.length === 0
        ? '未找到当前纷享员工的唯一企业资料，登录已拒绝。'
        : '当前纷享员工的企业资料不唯一，登录已拒绝。',
      403,
    )
  }
  const row = object(page.dataList[0])
  if (id(row.user_id) !== externalSubject) {
    throw new FxiaokeError('IDENTITY_PROFILE_MISMATCH', '纷享员工资料与登录身份不一致。', 409)
  }

  const lifeStatus = optionalText(row.life_status)
  const profile: VerifiedEmployeeIdentity = {
    externalSubject,
    phone: optionalText(row.phone),
    employeeNumber: optionalText(row.employee_number),
    displayName: optionalText(row.full_name) || name(row.name),
    status: status(row.status),
    loginDisabled: typeof row.is_pause_login === 'boolean' ? row.is_pause_login : null,
    lifeStatus,
    deleted: row.is_deleted === true,
  }
  if (
    profile.deleted
    || profile.loginDisabled === true
    || profile.status === '停用'
    || (profile.lifeStatus && profile.lifeStatus !== '正常')
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
