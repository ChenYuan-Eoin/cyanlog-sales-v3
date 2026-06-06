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
import { canAccessOrgAdmin, hasPermission } from '@/lib/permissions'

const PUBLIC_PATHS = ['/', '/login', '/register']
const PRIMARY_HOST = 'sales.cyanlog.icu'
const HOST_REDIRECTS: Record<string, { rootPath: string; preservePath: boolean }> = {
  'quote.cyanlog.icu': { rootPath: '/quotes', preservePath: true },
  'contract.cyanlog.icu': { rootPath: '/contracts', preservePath: true },
  'cyanlog.icu': { rootPath: '/', preservePath: true },
  'www.cyanlog.icu': { rootPath: '/', preservePath: true },
}
const PUBLIC_API_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/access/feishu',
  '/api/client-errors',
  '/api/contracts/process',
  '/api/health',
  '/api/health/flight-ready',
  '/api/cron',
]
const PASSWORD_CHANGE_ALLOWED_PATHS = [
  '/change-password',
  '/api/auth/me',
  '/api/auth/change-password',
]

// REQ: F003 自主可控 + RBAC
// 路径 → 所需权限（路由级权限，权限可配置于 roles.permissions）
const ROUTE_PERMISSIONS: Record<string, string> = {
  '/configs': 'config:*',
  '/admin': 'admin:access',
}

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.some(p => pathname === p)) return true
  if (pathname.startsWith('/api/')) {
    return PUBLIC_API_PATHS.some(p => pathname.startsWith(p))
  }
  return pathname.startsWith('/_next/') || pathname.startsWith('/favicon')
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

  const token = request.headers.get('authorization')?.replace('Bearer ', '') ||
    request.cookies.get('token')?.value

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(buildRedirectUrl(request, '/login'))
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const supabase = createClient(supabaseUrl, supabaseKey)

    // 步骤1: 验证token（必须先做，获取user_id）
    const { data: tokenRecord } = await supabase
      .from('auth_tokens')
      .select('user_id, expires_at')
      .eq('token', token)
      .single()

    if (!tokenRecord || (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date())) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.redirect(buildRedirectUrl(request, '/login'))
    }

    // 步骤2: 并行查询用户信息和角色权限
    const userId = tokenRecord.user_id

    const [{ data: userRow }, { data: userRolesData }] = await Promise.all([
      // 查询用户基本信息
      supabase
        .from('users')
        .select('id, org_id, must_change_password')
        .eq('id', userId)
        .maybeSingle(),
      // 查询角色和权限（一次查询获取code和permissions）
      supabase
        .from('user_roles')
        .select('scope_type, scope_id, roles:roles(code, permissions)')
        .eq('user_id', userId)
        .eq('scope_type', 'org'),
    ])

    if (!userRow) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.redirect(buildRedirectUrl(request, '/login'))
    }

    if (userRow.must_change_password && !isPasswordChangeAllowedPath(pathname)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Password change required', code: 'MUST_CHANGE_PASSWORD' }, { status: 403 })
      }
      return NextResponse.redirect(buildRedirectUrl(request, '/change-password'))
    }

    // 步骤3: 处理角色和权限数据
    const allPermissions: string[] = []
    const roleCodes: string[] = []

    for (const ur of userRolesData ?? []) {
      const r = (ur as unknown as { roles: { code: string; permissions: string[] | null } | null }).roles
      if (r?.code) {
        roleCodes.push(r.code)
        if (r.permissions) allPermissions.push(...r.permissions)
      }
    }

    // SUPER_ADMIN 拥有所有权限（超级管理员）
    if (roleCodes.includes('SUPER_ADMIN')) {
      allPermissions.push('*')
    }

    // 路径级权限校验
    const required = getRequiredPermission(pathname)
    const allowed = required === 'admin:access'
      ? canAccessOrgAdmin(allPermissions, roleCodes)
      : (!required || hasPermission(allPermissions, required))

    if (required && !allowed) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden', required }, { status: 403 })
      }
      return NextResponse.redirect(buildRedirectUrl(request, '/', `?denied=${encodeURIComponent(required)}`))
    }

    // 透传 user context 到下游 route handler / page
    const requestHeaders = new Headers(request.headers)
    requestHeaders.set('x-user-id', tokenRecord.user_id)
    requestHeaders.set('x-user-roles', roleCodes.join(','))
    requestHeaders.set('x-user-permissions', allPermissions.join(','))

    return NextResponse.next({ request: { headers: requestHeaders } })
  } catch {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.redirect(buildRedirectUrl(request, '/login'))
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
