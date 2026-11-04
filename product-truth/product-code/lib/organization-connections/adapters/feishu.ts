// REQ: F003 / WP50. Feishu supplies only its credential schema and directory protocol.
import { z } from 'zod'
import { OrganizationConnectionError } from '../errors'
import type { AdapterDirectoryRead, AdapterVerification, DirectoryAdapter, OrganizationConnectionAdapter, PreparedConnection } from '../types'

const inputSchema = z.object({
  appId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  appSecret: z.string().trim().max(512).optional().default(''),
}).strict()
const storedSchema = z.object({
  appId: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/),
  appSecret: z.string().min(1).max(512),
  externalTenantId: z.string().trim().min(1).max(255),
}).strict()

type FeishuDepartment = {
  department_id?: string
  open_department_id?: string
  parent_department_id?: string
  name?: string
  i18n_name?: { zh_cn?: string; en_us?: string }
  status?: { is_deleted?: boolean }
}
type FeishuUser = {
  user_id?: string
  open_id?: string
  department_ids?: string[]
  name?: string
  en_name?: string
  status?: { is_resigned?: boolean; is_frozen?: boolean }
}
type Page<T> = { items?: T[]; has_more?: boolean; page_token?: string }
const MAX_RECORDS = 10_000

function invalid(message: string) {
  return new OrganizationConnectionError('INVALID_CONFIGURATION', message, 400)
}
function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

async function tenantToken(credentials: z.infer<typeof storedSchema>) {
  let response: Response
  try {
    response = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      redirect: 'error',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: credentials.appId, app_secret: credentials.appSecret }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new OrganizationConnectionError('PROVIDER_UNREACHABLE', '系统暂时无法连接飞书，请稍后重试。', 502)
  }
  const data = await response.json().catch(() => null) as { code?: number; tenant_access_token?: string; tenant_key?: string } | null
  if (!response.ok || data?.code !== 0 || !data.tenant_access_token || !data.tenant_key) {
    throw new OrganizationConnectionError('PROVIDER_REJECTED', '飞书拒绝了当前应用凭据或未返回企业标识，请核对应用配置。', 502)
  }
  return { accessToken: data.tenant_access_token, tenantKey: data.tenant_key }
}

async function readPage<T>(url: URL, token: string, message: string): Promise<Page<T>> {
  let response: Response
  try {
    response = await fetch(url, {
      redirect: 'error',
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    throw new OrganizationConnectionError('PROVIDER_UNREACHABLE', message, 502)
  }
  const body = await response.json().catch(() => null) as { code?: number; data?: Page<T> } | null
  if (!response.ok || body?.code !== 0) {
    throw new OrganizationConnectionError('DIRECTORY_READ_FAILED', message, 502)
  }
  return body.data || {}
}

async function readAllPages<T>(url: URL, token: string, message: string): Promise<T[]> {
  const items: T[] = []
  const seenPageTokens = new Set<string>()
  let pageToken = ''
  do {
    const pageUrl = new URL(url)
    if (pageToken) pageUrl.searchParams.set('page_token', pageToken)
    const page = await readPage<T>(pageUrl, token, message)
    items.push(...(page.items || []))
    if (items.length > MAX_RECORDS) {
      throw new OrganizationConnectionError('DIRECTORY_TOO_LARGE', '飞书通讯录超过本次安全上限，不能生成完整快照。', 409)
    }
    if (!page.has_more) break
    const nextToken = text(page.page_token)
    if (!nextToken || seenPageTokens.has(nextToken)) {
      throw new OrganizationConnectionError('DIRECTORY_PAGINATION_INVALID', '飞书通讯录分页标记无效，不能把部分结果用于同步。', 409)
    }
    seenPageTokens.add(nextToken)
    pageToken = nextToken
  } while (pageToken)
  return items
}

async function readDepartments(token: string): Promise<FeishuDepartment[]> {
  const result: FeishuDepartment[] = []
  const seen = new Set<string>()
  const queue = ['0']
  while (queue.length) {
    const parentId = queue.shift()!
    const url = new URL(`https://open.feishu.cn/open-apis/contact/v3/departments/${encodeURIComponent(parentId)}/children`)
    url.searchParams.set('department_id_type', 'department_id')
    url.searchParams.set('user_id_type', 'user_id')
    url.searchParams.set('page_size', '50')
    const children = await readAllPages<FeishuDepartment>(url, token, '飞书部门读取失败，请检查应用的通讯录权限。')
    for (const item of children) {
      if (item.status?.is_deleted) continue
      const departmentId = item.department_id || item.open_department_id || ''
      if (!departmentId || seen.has(departmentId)) continue
      seen.add(departmentId)
      result.push(item)
      queue.push(departmentId)
    }
  }
  return result
}

async function readEmployees(token: string, departmentIds: string[]): Promise<FeishuUser[]> {
  const result: FeishuUser[] = []
  const seen = new Set<string>()
  for (const departmentId of ['0', ...departmentIds]) {
    const url = new URL('https://open.feishu.cn/open-apis/contact/v3/users/find_by_department')
    url.searchParams.set('department_id', departmentId)
    url.searchParams.set('department_id_type', 'department_id')
    url.searchParams.set('user_id_type', 'user_id')
    url.searchParams.set('page_size', '50')
    const employees = await readAllPages<FeishuUser>(url, token, '飞书成员读取失败，请检查应用的通讯录权限。')
    for (const employee of employees) {
      const employeeId = employee.user_id || employee.open_id || ''
      if (!employeeId || seen.has(employeeId)) continue
      seen.add(employeeId)
      result.push(employee)
      if (result.length > MAX_RECORDS) {
        throw new OrganizationConnectionError('DIRECTORY_TOO_LARGE', '飞书通讯录超过本次安全上限，不能生成完整快照。', 409)
      }
    }
  }
  return result
}

export const feishuConnectionAdapter: OrganizationConnectionAdapter = {
  provider: 'feishu',
  label: '飞书',
  fields: [
    { key: 'appId', label: 'AppID', type: 'text', placeholder: '填写飞书自建应用 App ID', help: '进入飞书开放平台，在对应自建应用的企业自建应用凭据页复制 App ID。', secret: false },
    { key: 'appSecret', label: 'App Secret', type: 'password', placeholder: '留空将保留同一应用的已保存密钥', help: '首次配置或更换 AppID 时必须填写；密钥只保存在服务端。', secret: true },
  ],
  parseInput(value) {
    const parsed = inputSchema.safeParse(value)
    if (!parsed.success) throw invalid('请填写有效的飞书 AppID 和 AppSecret。')
    return parsed.data
  },
  prepare(input, previous): PreparedConnection {
    const parsed = inputSchema.parse(input)
    const sameApp = Boolean(previous && previous.appId === parsed.appId)
    const appSecret = parsed.appSecret || (sameApp && text(previous?.appSecret) ? String(previous?.appSecret) : '')
    if (!appSecret) throw invalid('首次配置或更换 AppID 时，请填写 AppSecret。')
    const externalTenantId = sameApp && text(previous?.externalTenantId)
      ? String(previous?.externalTenantId)
      : `pending-feishu-${parsed.appId}`
    return {
      credentials: { appId: parsed.appId, appSecret, externalTenantId },
      metadata: { appId: parsed.appId },
      externalTenantId,
    }
  },
  async verifyConnection(credentials): Promise<AdapterVerification> {
    const parsed = storedSchema.parse(credentials)
    const token = await tenantToken(parsed)
    if (!parsed.externalTenantId.startsWith('pending-') && !parsed.externalTenantId.startsWith('feishu-app:') && parsed.externalTenantId !== token.tenantKey) {
      throw new OrganizationConnectionError('ENTERPRISE_MISMATCH', '飞书应用所属企业与已保存配置不一致。', 409)
    }
    return {
      checkedAt: new Date().toISOString(),
      externalTenantId: token.tenantKey,
      metadata: { appId: parsed.appId, tenantKey: token.tenantKey },
      // Persist the provider tenant key, never an AppID-derived substitute.
      // The legacy feishu-app:* value is accepted once so the next save can
      // migrate it without treating it as an enterprise switch.
      credentialPatch: { ...parsed, externalTenantId: token.tenantKey },
    }
  },
  validateStored(credentials) {
    const parsed = storedSchema.safeParse(credentials)
    if (!parsed.success) throw new OrganizationConnectionError('CREDENTIALS_UNREADABLE', '已保存的飞书连接配置不完整，请重新配置。', 503)
    return parsed.data
  },
}

/**
 * Feishu directory capability. There is intentionally no Feishu enterprise-login
 * adapter in this batch, so directory support cannot enable SSO by implication.
 */
export const feishuDirectoryAdapter: DirectoryAdapter = {
  provider: 'feishu',
  supportsScopeProof: false,
  async readDirectory(credentials): Promise<AdapterDirectoryRead> {
    const parsed = storedSchema.parse(credentials)
    const token = await tenantToken(parsed)
    const departmentRows = await readDepartments(token.accessToken)
    const departments = departmentRows
      .filter(item => !item.status?.is_deleted)
      .map(item => ({
        id: item.department_id || item.open_department_id || '',
        name: item.name || item.i18n_name?.zh_cn || item.i18n_name?.en_us || item.department_id || item.open_department_id || '',
        parentId: item.parent_department_id && item.parent_department_id !== '0' ? item.parent_department_id : null,
        status: 'active',
      }))
      .filter(item => item.id && item.name)
    const employeeRows = await readEmployees(token.accessToken, departments.map(item => item.id))
    const employees = employeeRows.map(item => ({
      id: item.user_id || item.open_id || '',
      name: item.name || item.en_name || item.user_id || item.open_id || '',
      departmentIds: item.department_ids || [],
      // Feishu user-list does not expose a primary-department field. A single
      // membership is sufficient; multiple memberships require explicit proof
      // rather than relying on array ordering.
      primaryDepartmentId: item.department_ids?.length === 1 ? item.department_ids[0] : null,
      status: item.status?.is_resigned ? 'resigned' : item.status?.is_frozen ? 'frozen' : 'active',
      loginDisabled: item.status?.is_frozen ?? null,
    })).filter(item => item.id && item.name)
    const departmentIds = new Set(departments.map(item => item.id))
    const missingParent = departments.some(item => item.parentId && !departmentIds.has(item.parentId))
    const missingEmployeeDepartment = employees.some(item => item.departmentIds.some(id => !departmentIds.has(id)))
    const employeeWithoutDepartment = employees.some(item => item.departmentIds.length === 0)
    const employeeWithoutPrimaryDepartment = employees.some(item => item.departmentIds.length > 1 && !item.primaryDepartmentId)
    return {
      checkedAt: new Date().toISOString(),
      complete: departments.length > 0
        && employees.length > 0
        && !missingParent
        && !missingEmployeeDepartment
        && !employeeWithoutDepartment
        && !employeeWithoutPrimaryDepartment,
      // Recursive pagination proves the returned tree is internally complete;
      // it does not prove the app's visibility scope is the whole enterprise.
      scopeVerified: false,
      scopeEvidence: null,
      departments,
      employees,
      warnings: [
        '已读取授权范围内的全部分页，但分页完成不等于拥有全公司通讯录权限。',
        ...(missingParent ? ['部分部门的上级不在可读取范围内。'] : []),
        ...(missingEmployeeDepartment ? ['部分成员引用了可读范围外的部门。'] : []),
        ...(employeeWithoutDepartment ? ['部分成员没有部门关系。'] : []),
        ...(employeeWithoutPrimaryDepartment ? ['部分成员属于多个部门，但接口未返回独立的主属部门标识；禁止按数组顺序猜测。'] : []),
      ],
    }
  },
  normalizeDirectoryStatus(value) {
    const normalized = value.trim().toLowerCase()
    if (['active', 'enabled'].includes(normalized)) return 'active'
    if (['inactive', 'disabled', 'resigned', 'frozen'].includes(normalized)) return 'inactive'
    if (normalized === 'deleted') return 'deleted'
    return 'unknown'
  },
}
