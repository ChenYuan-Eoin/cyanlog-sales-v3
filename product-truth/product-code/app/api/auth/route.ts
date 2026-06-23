// REQ:F003
// FREEZE-SPEC:3.2

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { registerSchema } from '@/lib/validation'

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

// 统一错误响应
function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// POST /api/auth/register - 用户注册
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Zod验证
    const result = registerSchema.safeParse(body)
    if (!result.success) {
      const firstError = result.error.issues[0]
      return errorResponse(firstError.message, 400, 'VALIDATION_ERROR')
    }

    const { email, phone, password, name } = result.data

    // 检查邮箱/手机号是否已注册
    if (email) {
      const { data: existingUser } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('email', email)
        .single()

      if (existingUser) {
        return errorResponse('邮箱已被注册', 409, 'EMAIL_EXISTS')
      }
    }

    if (phone) {
      const { data: existingUser } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('phone', phone)
        .single()

      if (existingUser) {
        return errorResponse('手机号已被注册', 409, 'PHONE_EXISTS')
      }
    }

    // 密码加密
    const saltRounds = 12
    const passwordHash = await bcrypt.hash(password, saltRounds)

    // 创建用户
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .insert({
        id: uuidv4(),
        email,
        phone,
        display_name: name,
        password_hash: passwordHash,
        status: 'active',
      })
      .select()
      .single()

    if (error) {
      console.error('Registration error:', error)
      return errorResponse('创建用户失败', 500, 'USER_CREATE_FAILED')
    }

    // 生成 token
    const token = uuidv4()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7)

    await supabaseAdmin.from('auth_tokens').insert({
      id: uuidv4(),
      token,
      user_id: user.id,
      expires_at: expiresAt.toISOString(),
    })

    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.display_name,
      },
      token,
      expiresAt: expiresAt.toISOString(),
    })

    response.cookies.set('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
      expires: expiresAt,
    })

    return response
  } catch (error) {
    console.error('Registration error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
