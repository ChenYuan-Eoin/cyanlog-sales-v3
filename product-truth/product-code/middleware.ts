import { assertDatabaseEnvironment } from '@/lib/database-environment'
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
import { createClient } from '@supabase/supabase-js'
import { getRequestAuthToken } from '@/lib/auth-token'
import { canAccessOrgAdmin, hasPermission } from '@/lib/permissions'
import { resolveRolePermissions } from '@/lib/role-permission-policy'

const PUBLIC_PATHS = ['/login', '/register', '/sales-portal']
const PRIMARY_HOST = 'sales.cyanlog.icu'
const HOST_REDIRECTS: Record<string, { rootPath: string; preservePath: boolean }> = {
  'quote.cyanlog.icu': { rootPath: '/quotes', preservePath: true },
  'contract.cyanlog.icu': { rootPath: '/contracts', preservePath: true },
  'cyanlog.icu': { rootPath: '/', preservePath: true },
  'www.cyanlog.icu': { rootPath: '/', preservePath: true },
}
const PUBLIC_API_PATHS = new Set([
  '/api/auth',
  '/api/auth/login',
  '/api/auth/prewarm',
  '/api/auth/register',
  '/api/client-errors',
  '/api/contracts/process',
  '/api/health',
  '/api/health/flight-ready',
  '/api/cron',
])
const PASSWORD_CHANGE_ALLOWED_PATHS = [
  '/change-password',
  '/api/auth/me',
  '/api/auth/change-password',
]

// REQ: F003 自主可控 + RBAC
// 路径 → 所需权限（路由级权限，权限可配置于 roles.permissions）
const ROUTE_PERMISSIONS: Record<string, string> = {
  '/configs': 'config:read',
  '/admin': 'admin:access',
}

type MiddlewareAuthContext = {
  userId: string
  orgId: string
  mustChangePassword: boolean
  roleCodes: string[]
  authorizationRoleCodes: string[]
  allPermissions: string[]
}


function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some(p => pathname === p)) return true
  if (pathname.startsWith('/api/')) {
    return PUBLIC_API_PATHS.has(pathname) || pathname.startsWith('/api/shipping/public/')
  }
  return pathname.startsWith('/_next/')
    || pathname.startsWith('/favicon')
    || pathname.startsWith('/brand/')
}

function getRequiredPermission(pathname: string): string | null {
  for (const [prefix, perm] of Object.entries(ROUTE_PERMISSIONS)) {
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return perm
  }
  return null
}

function isPasswordChangeAllowedPath(pathname: string): boolean {
  return PASSWORD_CHANGE_ALLOWED_PATHS.some((path) => pathname === path || pathname.startsWith(path + '/'))
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

function createMiddlewareSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is required for auth middleware')
  }

  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for auth middleware')
  }

  assertDatabaseEnvironment({ databaseUrl: supabaseUrl, vercel: process.env.VERCEL, vercelEnv: process.env.VERCEL_ENV })
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

function roleRecordOf(value: unknown): { id: string; code: string; permissions: string[] | null } | null {
  if (Array.isArray(value)) {
    return roleRecordOf(value[0])
  }
  if (!value || typeof value !== 'object') return null
  return value as { id: string; code: string; permissions: string[] | null }
}

async function loadMiddlewareAuthContext(token: string): Promise<MiddlewareAuthContext | null> {
  const supabase = createMiddlewareSupabaseClient()

  const { data: tokenRecord } = await supabase
    .from('auth_tokens')
    .select('user_id, expires_at')
    .eq('token', token)
    .single()

  if (!tokenRecord || (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date())) {
    return null
  }

  const userId = tokenRecord.user_id
  const { data: userRow } = await supabase
    .from('users')
    .select('id, org_id, must_change_password, status, login_enabled')
    .eq('id', userId)
    .maybeSingle()

  if (
    !userRow
    || userRow.status !== 'active'
    || userRow.login_enabled !== true
  ) return null

  const { data: defaultMembership, error: defaultMembershipError } = await supabase
    .from('user_organizations')
    .select('org_id')
    .eq('user_id', userId)
    .eq('is_default', true)
    .maybeSingle()

  if (defaultMembershipError) return null

  const orgId = defaultMembership?.org_id || userRow.org_id
  if (!orgId) return null

  const { data: userRolesData, error: userRolesError } = await supabase
    .from('user_roles')
    .select('scope_type, scope_id, roles:roles(id, code, permissions)')
    .eq('user_id', userId)
    .eq('scope_type', 'org')
    .eq('scope_id', orgId)

  if (userRolesError) throw userRolesError
  const { data: organization, error: organizationError } = await supabase
    .from('organizations').select('settings').eq('id', orgId).maybeSingle()
  if (organizationError || !organization) throw organizationError || new Error('Organization permissions unavailable')

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
    mustChangePassword: Boolean(userRow.must_change_password),
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

    if (authContext.mustChangePassword && !isPasswordChangeAllowedPath(pathname)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Password change required', code: 'MUST_CHANGE_PASSWORD' }, { status: 403 })
      }
      return NextResponse.redirect(buildRedirectUrl(request, '/change-password'))
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
