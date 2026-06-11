import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { loginSchema } from '@/lib/validation'

// 统一错误响应格式
function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json(
    { error: message, code },
    { status }
  )
}

// POST /api/auth/login - 用户登录
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Zod验证
    const result = loginSchema.safeParse(body)
    if (!result.success) {
      const firstError = result.error.issues[0]
      return errorResponse(firstError.message, 400, 'VALIDATION_ERROR')
    }

    const { email, phone, password } = result.data

    // 查找用户
    let query = supabaseAdmin.from('users').select('id, email, phone, display_name, password_hash')
    if (email) {
      query = query.eq('email', email)
    } else {
      query = query.eq('phone', phone)
    }

    const { data: user, error: userError } = await query.single()

    if (userError || !user) {
      return errorResponse('邮箱/手机号或密码错误', 401, 'AUTH_FAILED')
    }

    // 验证密码
    const isValid = await bcrypt.compare(password, user.password_hash)
    if (!isValid) {
      return errorResponse('邮箱/手机号或密码错误', 401, 'AUTH_FAILED')
    }

    // 生成 token
    const token = uuidv4()
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + 7) // 7天过期

    const { error: tokenError } = await supabaseAdmin.from('auth_tokens').insert({
      id: uuidv4(),
      token,
      user_id: user.id,
      expires_at: expiresAt.toISOString(),
    })

    if (tokenError) {
      console.error('Token insert error:', tokenError)
      return errorResponse('登录失败，请重试', 500, 'TOKEN_CREATE_FAILED')
    }

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.display_name,
      },
      token,
      expiresAt: expiresAt.toISOString(),
    })
  } catch (error) {
    console.error('Login error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
