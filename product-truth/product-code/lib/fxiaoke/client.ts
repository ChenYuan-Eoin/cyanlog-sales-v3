// REQ: F003 / WP91. Official self-built app OAuth and paginated CRM directory reads.
// https://developer.fxiaoke.com/openapi_v2/start/auth/app-info.html
// https://developer.fxiaoke.com/openapi_v2/start/example/public.html
import { randomUUID } from 'node:crypto'
import { FxiaokeError, type Credentials, type DirectoryPreview } from './contracts'

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

export async function previewDirectory(credentials: Credentials, request: typeof fetch = fetch): Promise<DirectoryPreview> {
  const signal = AbortSignal.timeout(45_000)
  async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
    let response: Response
    try {
      response = await request(`${ORIGIN}${path}?thirdTraceId=${randomUUID()}`, {
        method: 'POST', redirect: 'error', cache: 'no-store', signal,
        headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
      })
    } catch {
      throw new FxiaokeError('PROVIDER_UNREACHABLE', '连接纷享失败或超时，请检查网络、应用 IP 白名单后重试。', 502)
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
          limit: LIMIT, offset, fieldProjection: fields, filters: [],
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

// Only returns the provider's enterprise account; tokens and corp identifiers remain server-side.
export async function discoverEnterprise(credentials: Pick<Credentials, 'appId' | 'appSecret' | 'permanentCode'>, request: typeof fetch = fetch): Promise<{ ea: string }> {
  let response: Response
  try {
    response = await request(`${ORIGIN}/oauth2.0/token?thirdTraceId=${randomUUID()}`, {
      method: 'POST', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appId: credentials.appId, appSecret: credentials.appSecret, permanentCode: credentials.permanentCode, grantType: 'app_secret' }),
    })
  } catch {
    throw new FxiaokeError('PROVIDER_UNREACHABLE', '连接纷享失败或超时，请检查网络、应用 IP 白名单后重试。', 502)
  }
  if (!response.ok) throw new FxiaokeError('PROVIDER_HTTP_ERROR', `纷享接口返回 HTTP ${response.status}，未能获取企业账号。`, 502)
  let data: Row
  try { data = object(await response.json()) } catch { throw new FxiaokeError('INVALID_RESPONSE', '纷享接口没有返回有效数据。', 502) }
  if (data.errorCode !== 0) {
    const code = Number.isSafeInteger(data.errorCode) ? String(data.errorCode) : '未知'
    throw new FxiaokeError('PROVIDER_REJECTED', `纷享拒绝请求（错误码 ${code}）。请核对应用凭据、IP 白名单和 OpenAPI 权益。`, 502)
  }
  if (data.appId !== credentials.appId || typeof data.ea !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(data.ea) || typeof data.accessToken !== 'string' || !data.accessToken || typeof data.openUserId !== 'string' || !data.openUserId.startsWith('FSCID_')) {
    throw new FxiaokeError('INVALID_TOKEN_RESPONSE', '纷享未返回有效的企业授权信息，请检查应用配置。', 502)
  }
  return { ea: data.ea }
}
