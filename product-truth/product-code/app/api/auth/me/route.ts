import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { canManageOrg, getOrgScopedAssignments, getUserScopedRoleAssignments } from '@/lib/scoped-access'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const scopedAssignments = await getUserScopedRoleAssignments(user.id)

    const { data: userRow, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, phone, display_name, title, primary_dept_id, org_id, must_change_password')
      .eq('id', user.id)
      .single()

    if (userError || !userRow) {
      return errorResponse('读取用户失败', 500, 'USER_FETCH_FAILED')
    }

    const roles = getOrgScopedAssignments(scopedAssignments).map((assignment) => ({
      code: assignment.roleCode,
      name: assignment.roleName,
    }))

    return NextResponse.json({
      user: {
        ...userRow,
        roles,
        scopedRoles: scopedAssignments,
        canManageOrg: canManageOrg(scopedAssignments),
        mustChangePassword: Boolean(userRow.must_change_password),
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
