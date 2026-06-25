import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { primeAuthCache } from '@/lib/auth'
import { primeDefaultOrgCache } from '@/lib/scoped-access'
import { primeDashboardPayload } from '@/lib/dashboard-data'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { loginSchema } from '@/lib/validation'
import { checkLoginRateLimit, getClientIp, recordLoginAttempt } from '@/lib/rate-limit'

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

// 统一错误响应格式
function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json(
    { error: message, code },
    { status }
  )
}

async function parseLoginPayload(req: NextRequest) {
  const contentType = req.headers.get('content-type') || ''

  if (contentType.includes('application/json')) {
    return req.json()
  }

  const formData = await req.formData()
  return {
    email: String(formData.get('email') || ''),
    phone: String(formData.get('phone') || ''),
    password: String(formData.get('password') || ''),
  }
}

// POST /api/auth/login - 用户登录
export async function POST(req: NextRequest) {
  try {
    const body = await parseLoginPayload(req)

    // Zod验证
    const result = loginSchema.safeParse(body)
    if (!result.success) {
      const firstError = result.error.issues[0]
      return errorResponse(firstError.message, 400, 'VALIDATION_ERROR')
    }

    const { email, phone, password } = result.data
    const identifier = email || phone!
    const ipAddress = getClientIp(req)

    const rateLimit = await checkLoginRateLimit(identifier, ipAddress)
    if (!rateLimit.allowed) {
      const response = errorResponse(
        '登录尝试过于频繁，请稍后再试',
        429,
        rateLimit.reason || 'RATE_LIMITED'
      )
      if (rateLimit.retryAfterSeconds !== undefined) {
        response.headers.set('Retry-After', String(rateLimit.retryAfterSeconds))
      }
      return response
    }

    let query = supabaseAdmin.from('users').select('id, email, phone, display_name, org_id, password_hash, must_change_password')
    if (email) {
      query = query.eq('email', email)
    } else {
      query = query.eq('phone', phone)
    }

    const { data: user, error: userError } = await query.single()

    if (userError || !user) {
      await recordLoginAttempt(identifier, ipAddress, false)
      return errorResponse('邮箱/手机号或密码错误', 401, 'AUTH_FAILED')
    }

    // 验证密码
    const isValid = await bcrypt.compare(password, user.password_hash)
    if (!isValid) {
      await recordLoginAttempt(identifier, ipAddress, false)
      return errorResponse('邮箱/手机号或密码错误', 401, 'AUTH_FAILED')
    }

    const authUser = {
      id: user.id,
      email: user.email,
      phone: user.phone,
      display_name: user.display_name,
      org_id: user.org_id,
    }
    primeDefaultOrgCache(user.id, user.org_id)
    primeDashboardPayload(authUser)

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

    primeAuthCache(token, authUser)

    await recordLoginAttempt(identifier, ipAddress, true)

    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        displayName: user.display_name,
      },
      token,
      expiresAt: expiresAt.toISOString(),
      mustChangePassword: Boolean(user.must_change_password),
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
    console.error('Login error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
