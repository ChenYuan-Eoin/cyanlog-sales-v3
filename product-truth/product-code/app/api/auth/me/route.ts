import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import {
  canManageOrg,
  getDefaultOrgId,
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
    const [scopedAssignments, orgId, userResult] = await Promise.all([
      getUserScopedRoleAssignments(user.id),
      getDefaultOrgId(user.id),
      supabaseAdmin
        .from('users')
        .select('id, email, phone, display_name, avatar_url, title, employee_id, last_login_at, primary_dept_id, org_id')
        .eq('id', user.id)
        .single(),
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
