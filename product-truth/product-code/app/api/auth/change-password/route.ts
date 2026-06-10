import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'

import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { changePasswordSchema } from '@/lib/validation'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(req: NextRequest) {
  try {
    const authUser = await requireAuth(req)
    const body = await req.json()

    const parsed = changePasswordSchema.safeParse(body)
    if (!parsed.success) {
      const firstError = parsed.error.issues[0]
      return errorResponse(firstError.message, 400, 'VALIDATION_ERROR')
    }

    const { currentPassword, newPassword } = parsed.data

    const { data: userRow, error: userError } = await supabaseAdmin
      .from('users')
      .select('id, password_hash, must_change_password')
      .eq('id', authUser.id)
      .single()

    if (userError || !userRow?.password_hash) {
      return errorResponse('读取用户失败', 500, 'USER_FETCH_FAILED')
    }

    const passwordValid = await bcrypt.compare(currentPassword, userRow.password_hash)
    if (!passwordValid) {
      return errorResponse('当前密码错误', 400, 'CURRENT_PASSWORD_INVALID')
    }

    const nextPasswordHash = await bcrypt.hash(newPassword, 12)

    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        password_hash: nextPasswordHash,
        must_change_password: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', authUser.id)
      .select('id')
      .single()

    if (updateError) {
      return errorResponse('更新密码失败', 500, 'PASSWORD_UPDATE_FAILED')
    }

    return NextResponse.json({
      ok: true,
      mustChangePassword: false,
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }

    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
