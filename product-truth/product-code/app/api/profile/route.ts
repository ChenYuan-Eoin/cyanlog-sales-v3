import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'

import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  phone: z.string().trim().max(32).optional().or(z.literal('')),
  avatarUrl: z.string().url().optional().or(z.literal('')),
})

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const { data: userRow, error } = await supabaseAdmin
      .from('users')
      .select('id, display_name, email, phone, avatar_url, title, employee_id, last_login_at')
      .eq('id', user.id)
      .single()

    if (error || !userRow) {
      return errorResponse('读取个人信息失败', 500, 'PROFILE_FETCH_FAILED')
    }

    return NextResponse.json({
      user: userRow,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const body = await req.json().catch(() => null)
    const parsed = profileUpdateSchema.safeParse(body)

    if (!parsed.success) {
      return errorResponse(parsed.error.issues[0]?.message || '参数错误', 400, 'VALIDATION_ERROR')
    }

    const payload = {
      display_name: parsed.data.displayName.trim(),
      phone: parsed.data.phone?.trim() ? parsed.data.phone.trim() : null,
      avatar_url: parsed.data.avatarUrl?.trim() ? parsed.data.avatarUrl.trim() : null,
      updated_at: new Date().toISOString(),
    }

    const { data: updatedUser, error } = await supabaseAdmin
      .from('users')
      .update(payload)
      .eq('id', user.id)
      .select('id, display_name, email, phone, avatar_url, title, employee_id, last_login_at')
      .single()

    if (error || !updatedUser) {
      return errorResponse('更新个人信息失败', 500, 'PROFILE_UPDATE_FAILED')
    }

    return NextResponse.json({
      user: updatedUser,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
