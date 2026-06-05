import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)

    const { data: roleRows, error: rolesError } = await supabaseAdmin
      .from('user_roles')
      .select('roles:roles(code, name)')
      .eq('user_id', user.id)

    if (rolesError) {
      return errorResponse('读取角色失败', 500, 'ROLES_FETCH_FAILED')
    }

    const { data: userRow, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, email, phone, display_name, title, primary_dept_id, org_id')
      .eq('id', user.id)
      .single()

    if (userError || !userRow) {
      return errorResponse('读取用户失败', 500, 'USER_FETCH_FAILED')
    }

    const roles = (roleRows || [])
      .map((row) => Array.isArray(row.roles) ? row.roles[0] : row.roles)
      .filter(Boolean)

    return NextResponse.json({
      user: {
        ...userRow,
        roles,
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
