import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { primeAuthCache } from '@/lib/auth'
import { primeDefaultOrgCache } from '@/lib/scoped-access'
import {
  cacheDashboardPayload,
  getCachedDashboardPayload,
  primeDashboardPayload,
  type DashboardPayload,
} from '@/lib/dashboard-data'
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

export const preferredRegion = 'sin1'

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

type LoginRateLimit = Awaited<ReturnType<typeof checkLoginRateLimit>>

type LoginUserPublicRow = {
  id: string
  email: string | null
  phone: string | null
  display_name: string | null
  org_id: string | null
  must_change_password: boolean | null
}

type LoginUserRow = LoginUserPublicRow & {
  password_hash: string
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

type LoginWithPasswordRpcData = {
  ok?: unknown
  code?: unknown
  retryAfterSeconds?: unknown
  user?: unknown
  roleCodes?: unknown
  allPermissions?: unknown
  dashboard?: unknown
  core?: unknown
}

type LoginAuthContext = {
  roleCodes: string[]
  allPermissions: string[]
  full: boolean
}

type InitialCorePagePayload = {
  contracts?: {
    contracts: unknown[]
    drafts: unknown[]
    meta: {
      totalPages: number
      hasNext: boolean
      hasPrev: boolean
    }
  } | null
  configs?: {
    products: unknown[]
  } | null
  quotes?: {
    quotes: unknown[]
  } | null
  tenders?: {
    tenders: unknown[]
  } | null
  agenda?: {
    items: unknown[]
  } | null
}

type LoginWithPasswordResult =
  | { kind: 'ok'; user: LoginUserPublicRow; authContext: LoginAuthContext; dashboard: DashboardPayload | null; core: InitialCorePagePayload | null }
  | { kind: 'rate_limited'; reason: string; retryAfterSeconds?: number }
  | { kind: 'auth_failed' }
  | { kind: 'server_error' }

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

function toOptionalSeconds(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.ceil(value)) : undefined
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function normalizeDashboardPayload(value: unknown): DashboardPayload | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const payload = value as Partial<DashboardPayload>
  return {
    spaces: Array.isArray(payload.spaces) ? payload.spaces : [],
    activeSpace: payload.activeSpace || null,
    opportunities: Array.isArray(payload.opportunities) ? payload.opportunities : [],
    milestones: Array.isArray(payload.milestones) ? payload.milestones : [],
    reminders: Array.isArray(payload.reminders) ? payload.reminders : [],
    agenda: Array.isArray(payload.agenda) ? payload.agenda : [],
  }
}

function normalizeCorePagePayload(value: unknown): InitialCorePagePayload | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const payload = value as Partial<InitialCorePagePayload>
  const contracts = payload.contracts && typeof payload.contracts === 'object'
    ? payload.contracts
    : null
  const contractMeta = contracts?.meta && typeof contracts.meta === 'object'
    ? contracts.meta
    : null
  const configs = payload.configs && typeof payload.configs === 'object'
    ? payload.configs
    : null
  const quotes = payload.quotes && typeof payload.quotes === 'object'
    ? payload.quotes
    : null
  const tenders = payload.tenders && typeof payload.tenders === 'object'
    ? payload.tenders
    : null
  const agenda = payload.agenda && typeof payload.agenda === 'object'
    ? payload.agenda
    : null

  return {
    contracts: contracts
      ? {
          contracts: Array.isArray(contracts.contracts) ? contracts.contracts : [],
          drafts: Array.isArray(contracts.drafts) ? contracts.drafts : [],
          meta: {
            totalPages: typeof contractMeta?.totalPages === 'number' ? contractMeta.totalPages : 1,
            hasNext: Boolean(contractMeta?.hasNext),
            hasPrev: Boolean(contractMeta?.hasPrev),
          },
        }
      : null,
    configs: configs
      ? {
          products: Array.isArray(configs.products) ? configs.products : [],
        }
      : null,
    quotes: quotes
      ? {
          quotes: Array.isArray(quotes.quotes) ? quotes.quotes : [],
        }
      : null,
    tenders: tenders
      ? {
          tenders: Array.isArray(tenders.tenders) ? tenders.tenders : [],
        }
      : null,
    agenda: agenda
      ? {
          items: Array.isArray(agenda.items) ? agenda.items : [],
        }
      : null,
  }
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

function normalizeLoginUserPublicRow(value: unknown): LoginUserPublicRow | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const user = value as Partial<LoginUserPublicRow>
  if (typeof user.id !== 'string') {
    return null
  }

  return {
    id: user.id,
    email: typeof user.email === 'string' ? user.email : null,
    phone: typeof user.phone === 'string' ? user.phone : null,
    display_name: typeof user.display_name === 'string' ? user.display_name : null,
    org_id: typeof user.org_id === 'string' ? user.org_id : null,
    must_change_password: Boolean(user.must_change_password),
  }
}

function normalizeLoginUserRow(value: unknown): LoginUserRow | null {
  const user = normalizeLoginUserPublicRow(value)
  if (!user || !value || typeof value !== 'object') {
    return null
  }

  const passwordHash = (value as Partial<LoginUserRow>).password_hash
  if (typeof passwordHash !== 'string') {
    return null
  }

  return {
    ...user,
    password_hash: passwordHash,
  }
}

async function loadLoginWithPasswordFromRpc(
  email: string | undefined,
  phone: string | undefined,
  password: string,
  ipAddress: string,
  token: string,
  expiresAt: Date
): Promise<LoginWithPasswordResult | null> {
  const since = new Date(Date.now() - LOGIN_LOCK_DURATION_MINUTES * 60 * 1000).toISOString()
  const { data, error } = await supabaseAdmin.rpc('login_with_password_v1', {
    p_email: email || null,
    p_phone: phone || null,
    p_password: password,
    p_ip_address: ipAddress,
    p_token_id: uuidv4(),
    p_token: token,
    p_expires_at: expiresAt.toISOString(),
    p_since: since,
    p_account_limit: LOGIN_MAX_FAILURES,
    p_ip_limit: LOGIN_MAX_FAILURES * 3,
  })

  if (error || !data || typeof data !== 'object') {
    return null
  }

  const result = data as LoginWithPasswordRpcData
  const code = typeof result.code === 'string' ? result.code : ''
  if (result.ok === true) {
    const user = normalizeLoginUserPublicRow(result.user)
    return user
      ? {
          kind: 'ok',
          user,
          authContext: {
            roleCodes: toStringArray(result.roleCodes),
            allPermissions: toStringArray(result.allPermissions),
            full: Array.isArray(result.roleCodes) && Array.isArray(result.allPermissions),
          },
          dashboard: normalizeDashboardPayload(result.dashboard),
          core: normalizeCorePagePayload(result.core),
        }
      : { kind: 'server_error' }
  }

  if (code === 'account_locked' || code === 'ip_locked') {
    return {
      kind: 'rate_limited',
      reason: code,
      retryAfterSeconds: toOptionalSeconds(result.retryAfterSeconds),
    }
  }

  if (code === 'AUTH_FAILED') {
    return { kind: 'auth_failed' }
  }

  return null
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

function createSessionExpiry() {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7)
  return expiresAt
}

async function createLoginSuccessResponse(
  user: LoginUserPublicRow,
  token: string,
  expiresAt: Date,
  authContext?: LoginAuthContext,
  initialDashboard?: DashboardPayload | null,
  initialCore?: InitialCorePagePayload | null
) {
  const authUser = {
    id: user.id,
    email: user.email,
    phone: user.phone,
    display_name: user.display_name,
    org_id: user.org_id,
  }
  primeDefaultOrgCache(user.id, user.org_id)
  if (!user.must_change_password && initialDashboard) {
    cacheDashboardPayload(authUser, initialDashboard)
  } else if (!user.must_change_password) {
    primeDashboardPayload(authUser)
  }

  primeAuthCache(token, authUser)

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
    authContextReady: Boolean(authContext?.full),
    initialDashboard: user.must_change_password
      ? null
      : initialDashboard || getCachedDashboardPayload(authUser),
    initialCore: user.must_change_password ? null : initialCore || null,
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
    roleCodes: authContext?.roleCodes ?? [],
    allPermissions: authContext?.allPermissions ?? [],
    full: Boolean(authContext?.full),
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

    let token = uuidv4()
    let expiresAt = createSessionExpiry()
    const loginWithPassword = await loadLoginWithPasswordFromRpc(
      email,
      phone,
      password,
      ipAddress,
      token,
      expiresAt
    )
    if (loginWithPassword?.kind === 'rate_limited') {
      const response = errorResponse(
        '登录尝试过于频繁，请稍后再试',
        429,
        loginWithPassword.reason
      )
      if (loginWithPassword.retryAfterSeconds !== undefined) {
        response.headers.set('Retry-After', String(loginWithPassword.retryAfterSeconds))
      }
      return response
    }
    if (loginWithPassword?.kind === 'auth_failed') {
      return errorResponse('邮箱/手机号或密码错误', 401, 'AUTH_FAILED')
    }
    if (loginWithPassword?.kind === 'server_error') {
      return errorResponse('登录失败，请重试', 500, 'LOGIN_RPC_FAILED')
    }
    if (loginWithPassword?.kind === 'ok') {
      return createLoginSuccessResponse(
        loginWithPassword.user,
        token,
        expiresAt,
        loginWithPassword.authContext,
        loginWithPassword.dashboard,
        loginWithPassword.core
      )
    }

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

    // 生成 token
    token = uuidv4()
    expiresAt = createSessionExpiry()

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

    void Promise.resolve(recordLoginAttempt(identifier, ipAddress, true)).catch((error) => {
      console.error('Login success audit error:', error)
    })

    return createLoginSuccessResponse(user, token, expiresAt)
  } catch (error) {
    console.error('Login error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
