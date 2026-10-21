import { NextRequest, NextResponse } from 'next/server'

import { requireAuth } from '@/lib/auth'
import { getRequestAuthToken } from '@/lib/auth-token'
import {
  AUTH_CONTEXT_COOKIE_MAX_AGE_SECONDS,
  AUTH_CONTEXT_COOKIE_NAME,
  createAuthContextCookieValue,
} from '@/lib/auth-context-cookie'
import {
  getDefaultOrgId,
  getOrgPermissions,
  getOrgAuthorizationRoleCodes,
  getOrgRoleCodes,
  getUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'

export const preferredRegion = 'sin1'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(req: NextRequest) {
  try {
    const token = getRequestAuthToken(req)
    if (!token) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }

    const user = await requireAuth(req)
    const [assignments, orgId, userResult] = await Promise.all([
      getUserScopedRoleAssignments(user.id),
      getDefaultOrgId(user.id),
      supabaseAdmin
        .from('users')
        .select('must_change_password')
        .eq('id', user.id)
        .single(),
    ])

    if (userResult.error || !userResult.data) {
      return errorResponse('读取用户失败', 500, 'USER_FETCH_FAILED')
    }

    const roleCodes = getOrgRoleCodes(assignments, orgId)
    const authorizationRoleCodes = getOrgAuthorizationRoleCodes(assignments, orgId)
    const allPermissions = getOrgPermissions(assignments, orgId)
    if (authorizationRoleCodes.includes('SUPER_ADMIN')) {
      allPermissions.push('*')
    }

    const authContextCookie = await createAuthContextCookieValue(token, {
      userId: user.id,
      orgId,
      mustChangePassword: Boolean(userResult.data.must_change_password),
      roleCodes,
      allPermissions,
      full: true,
    })

    const response = NextResponse.json({ ok: true })
    if (authContextCookie) {
      response.cookies.set(AUTH_CONTEXT_COOKIE_NAME, authContextCookie, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: AUTH_CONTEXT_COOKIE_MAX_AGE_SECONDS,
      })
    }

    return response
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }

    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
