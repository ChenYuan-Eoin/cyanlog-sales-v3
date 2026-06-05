import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

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

// REQ: F003 自主可控 + RBAC
// 路径 → 所需权限（路由级权限，权限可配置于 roles.permissions）
const ROUTE_PERMISSIONS: Record<string, string> = {
  '/configs': 'config:*',
  '/admin': 'org:*',
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

export function hasPermission(allPermissions: string[], required: string): boolean {
  if (allPermissions.includes('*') || allPermissions.includes(required)) {
    return true
  }

  const [requiredResource] = required.split(':')
  return allPermissions.some((permission) => {
    if (permission === '*') {
      return true
    }
    if (!permission.includes(':')) {
      return permission === required
    }
    const [resource, action] = permission.split(':')
    return resource === requiredResource && action === '*'
  })
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
    return NextResponse.redirect(new URL('/login', request.url))
  }

  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const supabase = createClient(supabaseUrl, supabaseKey)

    const { data: tokenRecord } = await supabase
      .from('auth_tokens')
      .select('user_id, expires_at')
      .eq('token', token)
      .single()

    if (!tokenRecord || (tokenRecord.expires_at && new Date(tokenRecord.expires_at) < new Date())) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
      return NextResponse.redirect(new URL('/login', request.url))
    }

    // 读取用户的角色与合并后的权限
    const { data: userRoles } = await supabase
      .from('user_roles')
      .select('roles:roles(permissions)')
      .eq('user_id', tokenRecord.user_id)

    const allPermissions: string[] = []
    const roleCodes: string[] = []
    for (const ur of userRoles ?? []) {
      const r = (ur as unknown as { roles: { permissions: string[] | null } | null }).roles
      if (r?.permissions) allPermissions.push(...r.permissions)
    }
    const { data: roleData } = await supabase
      .from('user_roles')
      .select('roles:roles(code)')
      .eq('user_id', tokenRecord.user_id)
    for (const ur of roleData ?? []) {
      const r = (ur as unknown as { roles: { code: string } | null }).roles
      if (r?.code) roleCodes.push(r.code)
    }

    // SUPER_ADMIN 拥有所有权限（超级管理员）
    if (roleCodes.includes('SUPER_ADMIN')) {
      allPermissions.push('*')
    }

    // 路径级权限校验
    const required = getRequiredPermission(pathname)
    if (required && !hasPermission(allPermissions, required)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Forbidden', required }, { status: 403 })
      }
      return NextResponse.redirect(new URL('/?denied=' + required, request.url))
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
    return NextResponse.redirect(new URL('/login', request.url))
  }
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
