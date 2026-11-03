// REQ: F003 / WP50. Feishu supplies only its credential schema and directory protocol.
import { z } from 'zod'
import { OrganizationConnectionError } from '../errors'
import type { AdapterContext, AdapterVerification, OrganizationConnectionAdapter, PreparedConnection } from '../types'

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
  const data = await response.json().catch(() => null) as { code?: number; tenant_access_token?: string } | null
  if (!response.ok || data?.code !== 0 || !data.tenant_access_token) {
    throw new OrganizationConnectionError('PROVIDER_REJECTED', '飞书拒绝了当前应用凭据，请核对 AppID 与 AppSecret。', 502)
  }
  return data.tenant_access_token
}

async function firstPage<T>(url: URL, token: string, message: string): Promise<Page<T>> {
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

export const feishuConnectionAdapter: OrganizationConnectionAdapter = {
  provider: 'feishu',
  label: '飞书',
  previewAvailable: true,
  syncAvailable: true,
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
      : `feishu-app:${parsed.appId}`
    return {
      credentials: { appId: parsed.appId, appSecret, externalTenantId },
      metadata: { appId: parsed.appId },
      externalTenantId,
    }
  },
  async verify(credentials, _context: AdapterContext): Promise<AdapterVerification> {
    const parsed = storedSchema.parse(credentials)
    const token = await tenantToken(parsed)
    const departmentUrl = new URL('https://open.feishu.cn/open-apis/contact/v3/departments/0/children')
    departmentUrl.searchParams.set('department_id_type', 'department_id')
    departmentUrl.searchParams.set('user_id_type', 'user_id')
    departmentUrl.searchParams.set('page_size', '50')
    const userUrl = new URL('https://open.feishu.cn/open-apis/contact/v3/users/find_by_department')
    userUrl.searchParams.set('department_id', '0')
    userUrl.searchParams.set('department_id_type', 'department_id')
    userUrl.searchParams.set('user_id_type', 'user_id')
    userUrl.searchParams.set('page_size', '50')
    const [departmentPage, userPage] = await Promise.all([
      firstPage<FeishuDepartment>(departmentUrl, token, '飞书部门读取失败，请检查应用的通讯录权限。'),
      firstPage<FeishuUser>(userUrl, token, '飞书成员读取失败，请检查应用的通讯录权限。'),
    ])
    const departments = (departmentPage.items || [])
      .filter(item => !item.status?.is_deleted)
      .map(item => ({
        id: item.department_id || item.open_department_id || '',
        name: item.name || item.i18n_name?.zh_cn || item.i18n_name?.en_us || item.department_id || item.open_department_id || '',
        parentId: item.parent_department_id || null,
        status: item.status?.is_deleted ? 'deleted' : 'active',
      }))
      .filter(item => item.id && item.name)
    const employees = (userPage.items || []).map(item => ({
      id: item.user_id || item.open_id || '',
      name: item.name || item.en_name || item.user_id || item.open_id || '',
      departmentIds: item.department_ids || [],
      status: item.status?.is_resigned ? 'resigned' : item.status?.is_frozen ? 'frozen' : 'active',
      loginDisabled: item.status?.is_frozen ?? null,
    })).filter(item => item.id && item.name)
    const warnings = [
      ...(departmentPage.has_more ? ['预览仅显示首批部门，确认同步前仍需生成完整差异。'] : []),
      ...(userPage.has_more ? ['预览仅显示首批成员，确认同步前仍需生成完整差异。'] : []),
    ]
    return {
      checkedAt: new Date().toISOString(),
      externalTenantId: parsed.externalTenantId,
      metadata: { appId: parsed.appId },
      departments,
      employees,
      warnings,
    }
  },
  validateStored(credentials) {
    const parsed = storedSchema.safeParse(credentials)
    if (!parsed.success) throw new OrganizationConnectionError('CREDENTIALS_UNREADABLE', '已保存的飞书连接配置不完整，请重新配置。', 503)
    return parsed.data
  },
}
