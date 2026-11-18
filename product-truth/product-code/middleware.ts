// 认证与权限中间件 — Next.js Edge Runtime
// REQ: F003 自主可控 + RBAC
//
// 【技术选型】
// - Next.js Middleware (Edge Runtime): 请求拦截层
//   备选：API Route内校验（每个路由重复代码，容易遗漏）
//   权衡：
//   1. Middleware在路由匹配前执行，统一拦截所有请求
//   2. Edge Runtime冷启动快（<1ms），适合高频认证检查
//   3. 但Edge有Runtime限制（无Node.js完整API，如fs/crypto部分方法）
//   4. 需要在Edge和Node.js之间平衡：认证逻辑放Edge，复杂业务放API Route
//
// - JWT Token存储: PostgreSQL (auth_tokens表) 而非纯内存
//   备选：Redis（更快，但增加依赖）/ 纯JWT无状态（无法强制失效）
//   权衡：
//   1. 需要支持"强制用户下线"（Token失效）
//   2. 需要支持Token过期自动清理
//   3. PostgreSQL事务一致性，与业务数据同库便于JOIN
//
// - 权限模型: RBAC + 数据范围隔离（org/department/space）
//   备选：ABAC属性权限（更灵活，但复杂度高）
//   权衡：
//   1. 销售系统角色相对固定（销售/经理/管理员），RBAC足够
//   2. 数据范围（org_id/department_id）作为查询条件，而非权限表达式
//   3. 实现简单，查询可优化（加索引），避免规则引擎性能开销
//
// - Host重定向: 多入口架构（quote.cyanlog.icu/contract.cyanlog.icu）
//   原因：不同业务角色有习惯性入口（销售进报价，法务进合同）
//   实现：DNS指向同一服务，Middleware根据Host重定向到对应路径

import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { getRequestAuthToken } from '@/lib/auth-token'
import { createMiddlewareRestClient } from '@/lib/middleware-rest-client'
import { canAccessOrgAdmin, hasPermission } from '@/lib/permissions'
import { resolveRolePermissions } from '@/lib/role-permission-resolution'
import { fxiaokeSessionDeadline } from '@/lib/auth/fxiaoke-session'

const PUBLIC_PATHS = ['/login', '/accept-invitation']
const RETIRED_EXACT_PATHS = new Set([
  '/register',
  '/change-password',
  '/api/auth',
  '/api/auth/register',
  '/api/auth/prewarm',
  '/api/auth/change-password',
])
const PRIMARY_HOST = 'sales.cyanlog.icu'
const HOST_REDIRECTS: Record<string, { rootPath: string; preservePath: boolean }> = {
  'quote.cyanlog.icu': { rootPath: '/quotes', preservePath: true },
  'contract.cyanlog.icu': { rootPath: '/contracts', preservePath: true },
  'cyanlog.icu': { rootPath: '/', preservePath: true },
  'www.cyanlog.icu': { rootPath: '/', preservePath: true },
}
const PUBLIC_API_PATHS = new Set([
  '/api/auth/providers',
  '/api/auth/login',
  '/api/auth/fxiaoke/start',
  '/api/auth/fxiaoke/callback',
  '/api/auth/invitations/accept',
  '/api/client-errors',
  '/api/contracts/process',
  '/api/health',
  '/api/health/flight-ready',
  '/api/cron',
  // Exact machine-to-machine CRM intake routes. Authentication and tenant
  // mapping are enforced by the route handlers with an HMAC request contract.
  '/api/shipping/crm/preflight',
  '/api/shipping/crm/orders',
  // Scoped machine credential is checked in the handler; no interactive user session.
  '/api/admin/organization-sources/fxiaoke/egress',
])
// REQ: F003 自主可控 + RBAC
// 路径 → 所需权限（路由级权限，权限可配置于 roles.permissions）
const ROUTE_PERMISSIONS: Record<string, string> = {
  '/configs': 'config:read',
  '/admin': 'admin:access',
  '/api/configs': 'config:read',
  '/api/config-center': 'config:read',
  '/api/admin': 'admin:access',
  '/api/roles': 'config:read',
  '/api/rules': 'config:read',
}

type MiddlewareAuthContext = {
  userId: string
  orgId: string
  authMethod: 'local' | 'fxiaoke'
  roleCodes: string[]
  authorizationRoleCodes: string[]
  allPermissions: string[]
}

type FxiaokeSourceRow = {
  authority_scope: { identity?: unknown } | null
  connection_state: string
  effective_revision: string | null
}


function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some(p => pathname === p)) return true
  if (pathname.startsWith('/api/')) {
    const authenticatedIntakePath = pathname === '/api/shipping/public/options'
      || pathname === '/api/shipping/public/orders'
      || pathname.startsWith('/api/shipping/public/orders/')
    return PUBLIC_API_PATHS.has(pathname)
      || (pathname.startsWith('/api/shipping/public/') && !authenticatedIntakePath)
  }
  return pathname.startsWith('/_next/')
    || pathname.startsWith('/favicon')
    || pathname.startsWith('/brand/')
}

function isRetiredAuthPath(pathname: string): boolean {
  return RETIRED_EXACT_PATHS.has(pathname)
    || /^\/api\/admin\/users\/[^/]+\/reset-password$/.test(pathname)
}

function getRequiredPermission(pathname: string): string | null {
  for (const [prefix, perm] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return perm
  }
  return null
}

const BASELINE_READ_PATHS = new Set([
  '/api/auth/me', '/api/auth/context', '/api/dashboard',
  '/api/quotes', '/api/contracts', '/api/contracts/drafts',
  '/api/tenders', '/api/knowledge/tree', '/api/knowledge/pages',
  '/api/agenda', '/api/opportunities', '/api/products',
  '/api/shipping/owner/profile', '/api/shipping/owner/orders',
])

// These read handlers already apply the current organization, owner or
// explicit knowledge-page scope. Other legacy GET handlers may return every
// row through the service client and need a separate scope review first.
function baselineReadAllowed(pathname: string): boolean {
  if (BASELINE_READ_PATHS.has(pathname)) return true
  return /^\/api\/quotes\/[^/]+$/.test(pathname)
    || /^\/api\/contracts\/[^/]+$/.test(pathname)
    || /^\/api\/knowledge\/pages\/[^/]+$/.test(pathname)
    || /^\/api\/shipping\/public\/orders\/[^/]+$/.test(pathname)
}

function buildRedirectUrl(request: NextRequest, pathname: string, search = ''): URL {
  const url = request.nextUrl.clone()
  const requestHost = request.headers.get('host')

  url.pathname = pathname
  url.search = search

  if (requestHost) {
    url.host = requestHost
    if (requestHost.includes('localhost') || requestHost.startsWith('127.0.0.1')) {
      url.protocol = 'http:'
    }
  }

  return url
}

function roleRecordOf(value: unknown): { id: string; code: string; permissions: string[] | null } | null {
  if (Array.isArray(value)) {
    return roleRecordOf(value[0])
  }
  if (!value || typeof value !== 'object') return null
  return value as { id: string; code: string; permissions: string[] | null }
}

async function loadMiddlewareAuthContext(token: string): Promise<MiddlewareAuthContext | null> {
  const rest = createMiddlewareRestClient()
  const tokenRows = await rest.selectRows<{
    user_id: string
    created_at?: string
    expires_at: string | null
    auth_method?: string
    user: {
      id: string
      status: string
      login_enabled: boolean | null
      memberships: Array<{ org_id: string; employment_status: string }>
    } | null
  }>(
    'auth_tokens',
    { token, 'user.memberships.status': 'active', 'user.memberships.is_default': 'true' },
    'user_id,created_at,expires_at,auth_method,user:users!auth_tokens_user_id_fkey('
      + 'id,status,login_enabled,memberships:user_organizations!user_organizations_user_id_fkey(org_id,employment_status))',
  )
  const tokenRecord = tokenRows[0]
  if (!tokenRecord || (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date())) return null

  const usesFxiaoke = tokenRecord.auth_method === 'fxiaoke'
  if (usesFxiaoke && !fxiaokeSessionDeadline(tokenRecord)) return null

  const userId = tokenRecord.user_id
  const user = tokenRecord.user
  if (!user || user.id !== userId || user.status !== 'active' || user.login_enabled !== true) return null
  if (user.memberships?.length !== 1) return null
  const membership = user.memberships[0]
  const orgId = membership.org_id
  if (!orgId || (usesFxiaoke && membership.employment_status !== 'active')) return null

  const [userRolesData, organizationRows, sources] = await Promise.all([
    rest.selectRows<{ scope_type: string; scope_id: string | null; roles: unknown }>(
      'user_roles',
      { user_id: userId, scope_type: 'org', scope_id: orgId },
      'scope_type,scope_id,roles:roles(id,code,permissions)',
      100,
    ),
    rest.selectRows<{ settings: unknown }>('organizations', { id: orgId }, 'settings'),
    usesFxiaoke ? rest.selectRows<FxiaokeSourceRow>(
      'organization_sources',
      { system_org_id: orgId, provider: 'fxiaoke', status: 'active' },
      'authority_scope,connection_state,effective_revision',
      2,
    ) : [],
  ])
  if (usesFxiaoke && (sources.length !== 1 || sources[0].authority_scope?.identity !== 'authoritative'
    || sources[0].connection_state !== 'verified' || !sources[0].effective_revision)) return null

  const organization = organizationRows[0]
  if (!organization) throw new Error('auth middleware organization permissions unavailable')

  const allPermissions: string[] = []
  const roleCodes: string[] = []
  const authorizationRoleCodes: string[] = []

  for (const ur of userRolesData ?? []) {
    const r = roleRecordOf((ur as { roles?: unknown }).roles)
    if (r?.id && r.code) {
      roleCodes.push(r.code)
      const effective = resolveRolePermissions(organization.settings, r)
      allPermissions.push(...effective.permissions)
      if (!effective.overridden) authorizationRoleCodes.push(r.code)
    }
  }

  if (authorizationRoleCodes.includes('SUPER_ADMIN')) {
    allPermissions.push('*')
  }

  return {
    userId,
    orgId,
    authMethod: tokenRecord.auth_method === 'fxiaoke' ? 'fxiaoke' : 'local',
    roleCodes,
    authorizationRoleCodes,
    allPermissions,
  }
}

async function getMiddlewareAuthContext(token: string): Promise<MiddlewareAuthContext | null> {
  // A disabled user or revoked token must stop working on the next request;
  // an isolate-local cache cannot provide that guarantee.
  return loadMiddlewareAuthContext(token)
}

async function hasDirectShippingOperateGrant(userId: string, orgId: string): Promise<boolean> {
  const rest = createMiddlewareRestClient()
  const points = await rest.selectRows<{ id: string }>('permission_points', { code: 'shipping:operate' }, 'id', 1)
  if (!points[0]?.id) return false
  const grants = await rest.selectRows<{ id: string }>('user_permission_assignments', {
    user_id: userId, org_id: orgId, permission_point_id: points[0].id,
  }, 'id', 1)
  return Boolean(grants[0]?.id)
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const host = request.headers.get('host')?.toLowerCase()
  const redirectRule = host ? HOST_REDIRECTS[host] : undefined

  if (redirectRule) {
    const url = request.nextUrl.clone()
    url.protocol = 'https:'
    url.host = PRIMARY_HOST
    url.pathname = redirectRule.preservePath && pathname !== '/' ? pathname : redirectRule.rootPath
    return NextResponse.redirect(url, 308)
  }

  if (isRetiredAuthPath(pathname)) {
    return pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'Not Found' }, { status: 404 })
      : new NextResponse('Not Found', { status: 404 })
  }

  if (isPublicPath(pathname)) {
    return NextResponse.next()
  }

  const token = getRequestAuthToken(request)

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(buildRedirectUrl(request, '/login'))
  }

  try {
    const required = getRequiredPermission(pathname)
    // Authorization always comes from the exact current-org database context.
    // The signed cookie remains a login warmup artifact, but is not a permission
    // source until default-org changes can invalidate it atomically.
    const authContext = await getMiddlewareAuthContext(token)

    if (!authContext) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.redirect(buildRedirectUrl(request, '/login'))
    }

    // Session management is authenticated but does not require a business role.
    if (pathname === '/api/auth/activity' && ['GET', 'POST'].includes(request.method)) return NextResponse.next()

    // Some legacy business APIs check only authentication. A role-free SSO
    // member may view only the waiting page and sign out; no business route
    // can be reached through a guessed URL or direct API request.
    if (authContext.roleCodes.length === 0) {
      if (pathname === '/pending-access' || pathname === '/api/auth/logout') return NextResponse.next()
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: '尚未分配业务权限', code: 'ROLE_REQUIRED' }, { status: 403 })
      }
      return NextResponse.redirect(buildRedirectUrl(request, '/pending-access'))
    }

    // A federated viewer can hold either read-only role, or both after a role
    // change. Neither combination turns legacy login-only routes into writes.
    // The one exception creates a pending work order owned by this member;
    // carrier ordering remains behind the operator permission.
    const federatedViewer = authContext.authMethod === 'fxiaoke'
      && authContext.roleCodes.every(code => code === 'FXIAOKE_BASELINE' || code === 'READONLY')
    if (federatedViewer && required && (required === 'config:read' || required === 'admin:access')) {
      return pathname.startsWith('/api/')
        ? NextResponse.json({ error: 'Forbidden', required }, { status: 403 })
        : NextResponse.redirect(buildRedirectUrl(request, '/'))
    }
    if (federatedViewer && pathname.startsWith('/api/') && ['GET', 'HEAD'].includes(request.method)
      && !baselineReadAllowed(pathname)) {
      return NextResponse.json({ error: '此数据尚未开放基础查看范围', code: 'READ_SCOPE_REQUIRED' }, { status: 403 })
    }
    const separatelyAuthorizedShipping = federatedViewer && pathname.startsWith('/api/shipping/')
      && pathname !== '/api/shipping/owner/orders'
      && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
      && await hasDirectShippingOperateGrant(authContext.userId, authContext.orgId)
    const baselineSelfSubmission = (pathname === '/api/shipping/owner/orders'
      || pathname === '/api/shipping/owner/profile')
      && authContext.roleCodes.includes('FXIAOKE_BASELINE')
    if (federatedViewer
      && !['GET', 'HEAD', 'OPTIONS'].includes(request.method)
      && pathname !== '/api/auth/logout'
      && !baselineSelfSubmission
      && !separatelyAuthorizedShipping) {
      return NextResponse.json({ error: '基础查看账号不能执行此操作', code: 'READ_ONLY' }, { status: 403 })
    }

    // 路径级权限校验
    const allowed = required === 'admin:access'
      ? canAccessOrgAdmin(authContext.allPermissions, authContext.authorizationRoleCodes)
      : (!required || hasPermission(authContext.allPermissions, required))

    if (required && !allowed) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden', required }, { status: 403 })
      }
      return NextResponse.redirect(buildRedirectUrl(request, '/', `?denied=${encodeURIComponent(required)}`))
    }

    // 透传 user context 到下游 route handler / page
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-user-id', authContext.userId)
    requestHeaders.set('x-org-id', authContext.orgId)
    requestHeaders.set('x-user-roles', authContext.roleCodes.join(','))
    requestHeaders.set('x-user-role-codes', authContext.roleCodes.join(','))
    requestHeaders.set('x-user-authorization-role-codes', authContext.authorizationRoleCodes.join(','))
    requestHeaders.set('x-user-permissions', authContext.allPermissions.join(','))

    return NextResponse.next({ request: { headers: requestHeaders } })
  } catch (error) {
    if (error instanceof Error && error.message.includes('auth middleware')) {
      console.error('Auth middleware misconfigured:', error.message)
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Authentication unavailable' }, { status: 503 })
      }
      return new NextResponse('Authentication unavailable', { status: 503 })
    }

    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(buildRedirectUrl(request, '/login'))
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
