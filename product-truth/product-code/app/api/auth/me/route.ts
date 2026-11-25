import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getRequestAuthToken } from '@/lib/auth-token'
import {
  canManageOrg,
  getDefaultOrgId,
  getFreshDefaultOrgId,
  getFreshUserScopedRoleAssignments,
  getOrgScopedAssignments,
  getUserScopedRoleAssignments,
} from '@/lib/scoped-access'

export const preferredRegion = 'sin1'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const token = getRequestAuthToken(req)
    const fresh = req.nextUrl.searchParams.get('fresh') === '1'
    const [scopedAssignments, orgId, userResult, sessionResult] = await Promise.all([
      (fresh ? getFreshUserScopedRoleAssignments : getUserScopedRoleAssignments)(user.id),
      (fresh ? getFreshDefaultOrgId : getDefaultOrgId)(user.id),
      supabaseAdmin
        .from('users')
        .select('id, email, phone, display_name, avatar_url, title, employee_id, last_login_at, primary_dept_id, org_id')
        .eq('id', user.id)
        .single(),
      supabaseAdmin.from('auth_tokens').select('user_id,auth_method').eq('token', token || '').maybeSingle(),
    ])
    const { data: userRow, error: userError } = userResult

    if (userError || !userRow) {
      return errorResponse('读取用户失败', 500, 'USER_FETCH_FAILED')
    }

    const roles = getOrgScopedAssignments(scopedAssignments, orgId).map((assignment) => ({
      code: assignment.roleCode,
      name: assignment.roleName,
    }))

    return NextResponse.json({
      user: {
        ...userRow,
        roles,
        scopedRoles: scopedAssignments,
        canManageOrg: canManageOrg(scopedAssignments, orgId),
        authMethod: sessionResult.data?.user_id === user.id ? sessionResult.data.auth_method : null,
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }

    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
