import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { primeAuthCache } from '@/lib/auth'
import { primeDefaultOrgCache } from '@/lib/scoped-access'
import { getCachedDashboardPayload, primeDashboardPayload } from '@/lib/dashboard-data'
import {
  AUTH_CONTEXT_COOKIE_MAX_AGE_SECONDS,
  AUTH_CONTEXT_COOKIE_NAME,
  createAuthContextCookieValue,
} from '@/lib/auth-context-cookie'
import bcrypt from 'bcryptjs'
import { v4 as uuidv4 } from 'uuid'
import { loginSchema } from '@/lib/validation'
import {
  LOGIN_LOCK_DURATION_MINUTES,
  LOGIN_MAX_FAILURES,
  checkLoginRateLimit,
  getClientIp,
  recordLoginAttempt,
} from '@/lib/rate-limit'

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

type LoginRateLimit = Awaited<ReturnType<typeof checkLoginRateLimit>>

type LoginUserRow = {
  id: string
  email: string | null
  phone: string | null
  display_name: string | null
  org_id: string | null
  password_hash: string
  must_change_password: boolean | null
}

type LoginCandidateRpcData = {
  accountCount?: unknown
  accountOldestAttemptedAt?: unknown
  ipCount?: unknown
  ipOldestAttemptedAt?: unknown
  user?: unknown
}

type LoginCandidate = {
  rateLimit: LoginRateLimit
  user: LoginUserRow | null
}

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

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function retryAfterSeconds(oldestAttemptedAt: unknown): number {
  if (typeof oldestAttemptedAt !== 'string') {
    return LOGIN_LOCK_DURATION_MINUTES * 60
  }

  const attemptedAtMs = new Date(oldestAttemptedAt).getTime()
  if (!Number.isFinite(attemptedAtMs)) {
    return LOGIN_LOCK_DURATION_MINUTES * 60
  }

  const retryAfter = Math.ceil(
    (attemptedAtMs + LOGIN_LOCK_DURATION_MINUTES * 60 * 1000 - Date.now()) / 1000
  )
  return Math.max(retryAfter, 0)
}

function buildRateLimitFromCandidate(data: LoginCandidateRpcData): LoginRateLimit {
  const accountCount = toCount(data.accountCount)
  const ipCount = toCount(data.ipCount)
  const ipFailureLimit = LOGIN_MAX_FAILURES * 3

  if (accountCount >= LOGIN_MAX_FAILURES) {
    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSeconds: retryAfterSeconds(data.accountOldestAttemptedAt),
      reason: 'account_locked',
    }
  }

  if (ipCount >= ipFailureLimit) {
    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSeconds: retryAfterSeconds(data.ipOldestAttemptedAt),
      reason: 'ip_locked',
    }
  }

  return {
    allowed: true,
    remainingAttempts: Math.max(0, LOGIN_MAX_FAILURES - Math.max(accountCount, ipCount)),
  }
}

function normalizeLoginUserRow(value: unknown): LoginUserRow | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const user = value as Partial<LoginUserRow>
  if (typeof user.id !== 'string' || typeof user.password_hash !== 'string') {
    return null
  }

  return {
    id: user.id,
    email: typeof user.email === 'string' ? user.email : null,
    phone: typeof user.phone === 'string' ? user.phone : null,
    display_name: typeof user.display_name === 'string' ? user.display_name : null,
    org_id: typeof user.org_id === 'string' ? user.org_id : null,
    password_hash: user.password_hash,
    must_change_password: Boolean(user.must_change_password),
  }
}

async function loadLoginCandidateFromRpc(
  email: string | undefined,
  phone: string | undefined,
  ipAddress: string
): Promise<LoginCandidate | null> {
  const since = new Date(Date.now() - LOGIN_LOCK_DURATION_MINUTES * 60 * 1000).toISOString()
  const { data, error } = await supabaseAdmin.rpc('get_login_candidate_v1', {
    p_email: email || null,
    p_phone: phone || null,
    p_ip_address: ipAddress,
    p_since: since,
    p_account_limit: LOGIN_MAX_FAILURES,
    p_ip_limit: LOGIN_MAX_FAILURES * 3,
  })

  if (error || !data || typeof data !== 'object') {
    return null
  }

  const candidate = data as LoginCandidateRpcData
  return {
    rateLimit: buildRateLimitFromCandidate(candidate),
    user: normalizeLoginUserRow(candidate.user),
  }
}

async function queryLoginUser(email: string | undefined, phone: string | undefined) {
  let query = supabaseAdmin.from('users').select('id, email, phone, display_name, org_id, password_hash, must_change_password')
  if (email) {
    query = query.eq('email', email)
  } else {
    query = query.eq('phone', phone)
  }

  return query.single()
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

    const loginCandidate = await loadLoginCandidateFromRpc(email, phone, ipAddress)
    const rateLimit = loginCandidate?.rateLimit ?? (await checkLoginRateLimit(identifier, ipAddress))
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

    let user = loginCandidate?.user ?? null
    let userError: unknown = null
    if (!loginCandidate) {
      const userResult = await queryLoginUser(email, phone)
      user = userResult.data as LoginUserRow | null
      userError = userResult.error
    }

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
    if (!user.must_change_password) {
      primeDashboardPayload(authUser)
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

    primeAuthCache(token, authUser)

    void Promise.resolve(recordLoginAttempt(identifier, ipAddress, true)).catch((error) => {
      console.error('Login success audit error:', error)
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
      mustChangePassword: Boolean(user.must_change_password),
      initialDashboard: user.must_change_password ? null : getCachedDashboardPayload(authUser),
    })

    response.cookies.set('token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
      expires: expiresAt,
    })

    const authContextCookie = await createAuthContextCookieValue(token, {
      userId: user.id,
      mustChangePassword: Boolean(user.must_change_password),
      roleCodes: [],
      allPermissions: [],
      full: false,
    })
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
    console.error('Login error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
