// 测试 app/api/auth/login/route.ts
// 覆盖：成功登录、密码错误、rate limit、参数验证

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

vi.mock('@/lib/rate-limit', () => ({
  LOGIN_LOCK_DURATION_MINUTES: 15,
  LOGIN_MAX_FAILURES: 5,
  checkLoginRateLimit: vi.fn(),
  recordLoginAttempt: vi.fn(),
  getClientIp: vi.fn(() => '127.0.0.1'),
}))

vi.mock('@/lib/dashboard-data', () => ({
  cacheDashboardPayload: vi.fn(),
  getCachedDashboardPayload: vi.fn().mockReturnValue(null),
  primeDashboardPayload: vi.fn(),
}))

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn(),
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { checkLoginRateLimit, recordLoginAttempt } from '@/lib/rate-limit'
import bcrypt from 'bcryptjs'
import { AUTH_CONTEXT_COOKIE_NAME, readAuthContextCookieValue } from '@/lib/auth-context-cookie'
import { GET, POST } from './route'

function makeRequest(body: any): any {
  return {
    json: async () => body,
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' }),
  }
}

function makeMalformedJsonRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' }),
  }
}

function makeMalformedFormRequest(): any {
  return {
    formData: async () => {
      throw new TypeError('invalid multipart')
    },
    method: 'POST',
    headers: new Headers({ 'content-type': 'multipart/form-data', 'x-forwarded-for': '127.0.0.1' }),
  }
}

function makeGetRequest(headers: Record<string, string> = {}): any {
  return {
    method: 'GET',
    headers: new Headers(headers),
  }
}

function makeChain(result: any) {
  const chain: any = {}
  ;['select', 'eq', 'insert'].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain)
  })
  chain.single = vi.fn().mockResolvedValue(result)
  return chain
}

describe('POST /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: null,
      error: { message: 'RPC not available in route unit tests' },
    })
  })

  describe('参数验证', () => {
    it('空 body → 400 VALIDATION_ERROR', async () => {
      const res = await POST(makeRequest({}))
      const body = await res.json()
      expect(res.status).toBe(400)
      expect(body.code).toBe('VALIDATION_ERROR')
    })

    it('无效 JSON → 400 VALIDATION_ERROR 且不调用登录 RPC', async () => {
      const res = await POST(makeMalformedJsonRequest())
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.code).toBe('VALIDATION_ERROR')
      expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
    })

    it('无效表单数据 → 400 VALIDATION_ERROR 且不调用登录 RPC', async () => {
      const res = await POST(makeMalformedFormRequest())
      const body = await res.json()

      expect(res.status).toBe(400)
      expect(body.code).toBe('VALIDATION_ERROR')
      expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
    })

    it('无 email/phone + password → 400', async () => {
      const res = await POST(makeRequest({ password: 'abc' }))
      expect(res.status).toBe(400)
    })

    it('email 格式错误 → 400', async () => {
      const res = await POST(makeRequest({ email: 'not-an-email', password: 'abc' }))
      expect(res.status).toBe(400)
    })

    it('phone 格式错误 → 400', async () => {
      const res = await POST(makeRequest({ phone: '12345', password: 'abc' }))
      expect(res.status).toBe(400)
    })
  })

  describe('rate limit', () => {
    it('rate limit 触发 → 429', async () => {
      ;(checkLoginRateLimit as any).mockResolvedValue({
        allowed: false,
        reason: 'account_locked',
        retryAfterSeconds: 600,
      })

      const res = await POST(makeRequest({ email: 'test@x.com', password: 'abc' }))
      const body = await res.json()
      expect(res.status).toBe(429)
      expect(body.code).toBe('account_locked')
      expect(res.headers.get('Retry-After')).toBe('600')
    })

    it('RPC rate limit 触发时不再执行旧查询 → 429', async () => {
      ;(supabaseAdmin.rpc as any).mockResolvedValue({
        data: {
          accountCount: 5,
          accountOldestAttemptedAt: new Date(Date.now() - 60_000).toISOString(),
          ipCount: 0,
          ipOldestAttemptedAt: null,
          user: null,
        },
        error: null,
      })

      const res = await POST(makeRequest({ email: 'test@x.com', password: 'abc' }))
      const body = await res.json()

      expect(res.status).toBe(429)
      expect(body.code).toBe('account_locked')
      expect(checkLoginRateLimit).not.toHaveBeenCalled()
      expect(supabaseAdmin.from).not.toHaveBeenCalled()
    })
  })

  describe('认证失败', () => {
    it('用户不存在 → 401 AUTH_FAILED + 记录失败', async () => {
      ;(checkLoginRateLimit as any).mockResolvedValue({ allowed: true, remainingAttempts: 5 })
      ;(supabaseAdmin.from as any).mockReturnValue(makeChain({ data: null, error: { code: 'PGRST116' } }))

      const res = await POST(makeRequest({ email: 'nobody@x.com', password: 'abc' }))
      const body = await res.json()
      expect(res.status).toBe(401)
      expect(body.code).toBe('AUTH_FAILED')
      expect(recordLoginAttempt).toHaveBeenCalledWith('nobody@x.com', '127.0.0.1', false)
    })

    it('密码错误 → 401 AUTH_FAILED + 记录失败', async () => {
      ;(checkLoginRateLimit as any).mockResolvedValue({ allowed: true, remainingAttempts: 3 })
      ;(supabaseAdmin.from as any).mockReturnValueOnce(
        makeChain({ data: { id: 'u1', password_hash: 'wrong-hash' }, error: null })
      )
      ;(bcrypt.compare as any).mockResolvedValue(false)

      const res = await POST(makeRequest({ email: 'u@x.com', password: 'wrong' }))
      expect(res.status).toBe(401)
      expect(recordLoginAttempt).toHaveBeenCalledWith('u@x.com', '127.0.0.1', false)
    })
  })

  describe('认证成功', () => {
    it('email + 正确密码 → 200 + token + 记录成功', async () => {
      ;(checkLoginRateLimit as any).mockResolvedValue({ allowed: true, remainingAttempts: 5 })
      ;(bcrypt.compare as any).mockResolvedValue(true)

      ;(supabaseAdmin.from as any)
        .mockReturnValueOnce(
          makeChain({ data: { id: 'u1', email: 'u@x.com', display_name: 'U' }, error: null })
        )
        .mockReturnValueOnce(makeChain({ data: null, error: null }))

      const res = await POST(makeRequest({ email: 'u@x.com', password: 'right' }))
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.token).toBeTruthy()
      expect(body.user.id).toBe('u1')
      expect(body.expiresAt).toBeTruthy()
      expect(body.mustChangePassword).toBe(false)
      expect(res.cookies.get('token')?.value).toBe(body.token)
      expect(recordLoginAttempt).toHaveBeenCalledWith('u@x.com', '127.0.0.1', true)
    })

    it('登录 RPC 超时 → 降级到直接登录路径并记录 timeout timing', async () => {
      const previousDeadline = process.env.LOGIN_RPC_DEADLINE_MS
      process.env.LOGIN_RPC_DEADLINE_MS = '1'
      ;(supabaseAdmin.rpc as any).mockImplementation(() => new Promise((resolve) => {
        setTimeout(() => resolve({ data: null, error: null }), 50)
      }))
      ;(checkLoginRateLimit as any).mockResolvedValue({ allowed: true, remainingAttempts: 5 })
      ;(bcrypt.compare as any).mockResolvedValue(true)
      ;(supabaseAdmin.from as any)
        .mockReturnValueOnce(
          makeChain({
            data: {
              id: 'u-timeout',
              email: 'timeout@x.com',
              phone: null,
              display_name: 'Timeout User',
              org_id: 'org-timeout',
              password_hash: 'hashed',
              must_change_password: false,
            },
            error: null,
          })
        )
        .mockReturnValueOnce(makeChain({ data: null, error: null }))

      try {
        const res = await POST(makeRequest({ email: 'timeout@x.com', password: 'right' }))
        const body = await res.json()

        expect(res.status).toBe(200)
        expect(body.user.id).toBe('u-timeout')
        expect(res.headers.get('Server-Timing')).toContain('login_rpc_timeout')
        expect(res.headers.get('X-Login-Timing')).toContain('login_rpc_timeout')
        expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1)
        expect(checkLoginRateLimit).toHaveBeenCalledWith('timeout@x.com', '127.0.0.1')
        expect(supabaseAdmin.from).toHaveBeenCalledWith('users')
        expect(recordLoginAttempt).toHaveBeenCalledWith('timeout@x.com', '127.0.0.1', true)
      } finally {
        if (previousDeadline === undefined) {
          delete process.env.LOGIN_RPC_DEADLINE_MS
        } else {
          process.env.LOGIN_RPC_DEADLINE_MS = previousDeadline
        }
      }
    })

    it('降级登录外部查询超时 → 快速返回 503 并记录超时阶段', async () => {
      const previousRpcDeadline = process.env.LOGIN_RPC_DEADLINE_MS
      const previousTransportDeadline = process.env.LOGIN_TRANSPORT_DEADLINE_MS
      process.env.LOGIN_RPC_DEADLINE_MS = '1'
      process.env.LOGIN_TRANSPORT_DEADLINE_MS = '1'
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      ;(supabaseAdmin.rpc as any).mockReturnValue(new Promise(() => undefined))
      ;(checkLoginRateLimit as any).mockReturnValue(new Promise(() => undefined))

      try {
        const res = await POST(makeRequest({ email: 'timeout@x.com', password: 'right' }))
        const body = await res.json()

        expect(res.status).toBe(503)
        expect(body.code).toBe('LOGIN_TRANSPORT_TIMEOUT')
        expect(res.headers.get('Server-Timing')).toContain('login_rpc_timeout')
        expect(res.headers.get('Server-Timing')).toContain('rate_limit_timeout')
        expect(res.headers.get('X-Login-Timing')).toContain('rate_limit_timeout')
        expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1)
        expect(checkLoginRateLimit).toHaveBeenCalledWith('timeout@x.com', '127.0.0.1')
        expect(supabaseAdmin.from).not.toHaveBeenCalled()
        expect(warn).toHaveBeenCalledWith('[auth/login] transport timeout', { stage: 'rate_limit' })
      } finally {
        warn.mockRestore()
        if (previousRpcDeadline === undefined) {
          delete process.env.LOGIN_RPC_DEADLINE_MS
        } else {
          process.env.LOGIN_RPC_DEADLINE_MS = previousRpcDeadline
        }
        if (previousTransportDeadline === undefined) {
          delete process.env.LOGIN_TRANSPORT_DEADLINE_MS
        } else {
          process.env.LOGIN_TRANSPORT_DEADLINE_MS = previousTransportDeadline
        }
      }
    })

    it('RPC 命中用户候选 → 200 且跳过旧 rate limit 与 users 查询', async () => {
      ;(supabaseAdmin.rpc as any).mockResolvedValue({
        data: {
          accountCount: 0,
          accountOldestAttemptedAt: null,
          ipCount: 0,
          ipOldestAttemptedAt: null,
          user: {
            id: 'u-rpc',
            email: 'rpc@x.com',
            phone: null,
            display_name: 'RPC User',
            org_id: 'org-rpc',
            password_hash: 'hashed',
            must_change_password: false,
          },
        },
        error: null,
      })
      ;(bcrypt.compare as any).mockResolvedValue(true)
      ;(supabaseAdmin.from as any).mockReturnValueOnce(makeChain({ data: null, error: null }))

      const res = await POST(makeRequest({ email: 'rpc@x.com', password: 'right' }))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.user.id).toBe('u-rpc')
      expect(checkLoginRateLimit).not.toHaveBeenCalled()
      expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
      expect(supabaseAdmin.from).toHaveBeenCalledWith('auth_tokens')
    })

    it('单 RPC 登录成功 → 200 且跳过 bcrypt 与 token insert', async () => {
      process.env.AUTH_CONTEXT_SECRET = 'test-auth-context-secret'
      ;(supabaseAdmin.rpc as any).mockImplementationOnce(async () => {
        await new Promise((resolve) => {
          setTimeout(resolve, 100)
        })
        return {
          data: {
            ok: true,
            code: 'OK',
            roleCodes: ['SUPER_ADMIN'],
            allPermissions: ['*', 'admin:access'],
            dashboard: {
              spaces: [{ id: 'space-1', name: '默认空间' }],
              activeSpace: { id: 'space-1', name: '默认空间' },
              opportunities: [],
              milestones: [],
              reminders: [],
              agenda: [],
            },
            core: {
              contracts: {
                contracts: [{ id: 'contract-1', filename: '合同.pdf', status: 'COMPLETED' }],
                drafts: [],
                meta: { totalPages: 1, hasNext: false, hasPrev: false },
              },
              configs: {
                products: [{ id: 'product-1', name: '企业版SaaS授权' }],
              },
              agenda: {
                items: [{ id: 'agenda-1', title: '客户跟进', start_at: '2026-06-26T01:00:00.000Z' }],
              },
            },
            timing: {
              input_validation: 0.4,
              token_write: 3.2,
              initial_dashboard: 42.8,
              initial_core: 18.5,
              total: 82.1,
              ignored_stage: 99,
            },
            user: {
              id: 'u-fast',
              email: 'fast@x.com',
              phone: null,
              display_name: 'Fast User',
              org_id: 'org-fast',
              must_change_password: false,
            },
          },
          error: null,
        }
      })

      const res = await POST(makeRequest({ email: 'fast@x.com', password: 'right' }))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.user.id).toBe('u-fast')
      expect(body.authContextReady).toBe(true)
      expect(res.headers.get('Server-Timing')).toContain('login_rpc')
      expect(res.headers.get('Server-Timing')).toContain('rpc_token_write;dur=3.2')
      expect(res.headers.get('Server-Timing')).toContain('rpc_initial_dashboard;dur=42.8')
      expect(res.headers.get('Server-Timing')).toContain('rpc_initial_core;dur=18.5')
      expect(res.headers.get('Server-Timing')).not.toContain('ignored_stage')
      expect(res.headers.get('Server-Timing')).toContain('login_rpc_transport')
      expect(res.headers.get('Server-Timing')).toContain('total')
      expect(res.headers.get('X-Login-Timing')).toContain('login_rpc')
      expect(res.headers.get('X-Login-Timing')).toContain('rpc_initial_dashboard;dur=42.8')
      expect(res.headers.get('X-Login-Timing')).toContain('login_rpc_transport')
      expect(res.headers.get('X-Login-Timing')).toContain('total')
      expect(body.initialDashboard).toMatchObject({
        activeSpace: { id: 'space-1', name: '默认空间' },
        opportunities: [],
      })
      expect(body.initialCore).toMatchObject({
        contracts: {
          contracts: [{ id: 'contract-1', filename: '合同.pdf', status: 'COMPLETED' }],
          meta: { totalPages: 1, hasNext: false, hasPrev: false },
        },
        configs: {
          products: [{ id: 'product-1', name: '企业版SaaS授权' }],
        },
        agenda: {
          items: [{ id: 'agenda-1', title: '客户跟进', start_at: '2026-06-26T01:00:00.000Z' }],
        },
      })
      const authContextCookie = res.cookies.get(AUTH_CONTEXT_COOKIE_NAME)?.value
      const authContext = await readAuthContextCookieValue(body.token, authContextCookie)
      expect(authContext).toMatchObject({
        userId: 'u-fast',
        roleCodes: ['SUPER_ADMIN'],
        allPermissions: ['*', 'admin:access'],
        full: true,
      })
      expect(checkLoginRateLimit).not.toHaveBeenCalled()
      expect(bcrypt.compare).not.toHaveBeenCalled()
      expect(recordLoginAttempt).not.toHaveBeenCalled()
      expect(supabaseAdmin.from).not.toHaveBeenCalled()
    })

    it('慢登录只记录脱敏阶段耗时', async () => {
      process.env.AUTH_CONTEXT_SECRET = 'test-auth-context-secret'
      const performanceNow = vi.spyOn(performance, 'now')
      let now = 0
      performanceNow.mockImplementation(() => {
        now += 150
        return now
      })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
      ;(supabaseAdmin.rpc as any).mockResolvedValueOnce({
        data: {
          ok: true,
          code: 'OK',
          roleCodes: ['ADMIN'],
          allPermissions: ['admin:access'],
          dashboard: {
            spaces: [],
            activeSpace: null,
            opportunities: [],
            milestones: [],
            reminders: [],
            agenda: [],
          },
          core: null,
          timing: {
            token_write: 12.3,
            initial_dashboard: 420.4,
            initial_core: 55.6,
            total: 498.3,
          },
          user: {
            id: 'u-slow',
            email: 'slow@example.com',
            phone: null,
            display_name: 'Slow User',
            org_id: 'org-slow',
            must_change_password: false,
          },
        },
        error: null,
      })

      try {
        const res = await POST(makeRequest({ email: 'slow@example.com', password: 'right' }))

        expect(res.status).toBe(200)
        expect(warn).toHaveBeenCalledWith('[auth/login] slow timing', expect.objectContaining({
          thresholdMs: 500,
          totalMs: expect.any(Number),
          stages: expect.arrayContaining([
            expect.objectContaining({ name: 'rpc_initial_dashboard', durationMs: 420.4 }),
            expect.objectContaining({ name: 'rpc_initial_core', durationMs: 55.6 }),
            expect.objectContaining({ name: 'rpc_token_write', durationMs: 12.3 }),
          ]),
        }))
        const warningPayload = JSON.stringify(warn.mock.calls)
        expect(warningPayload).not.toContain('slow@example.com')
        expect(warningPayload).not.toContain('u-slow')
        expect(warningPayload).not.toContain('Slow User')
      } finally {
        warn.mockRestore()
        performanceNow.mockRestore()
      }
    })

    it('首登临时密码用户返回 mustChangePassword', async () => {
      ;(checkLoginRateLimit as any).mockResolvedValue({ allowed: true, remainingAttempts: 5 })
      ;(bcrypt.compare as any).mockResolvedValue(true)

      ;(supabaseAdmin.from as any)
        .mockReturnValueOnce(
          makeChain({
            data: {
              id: 'u2',
              email: 'temp@x.com',
              display_name: 'Temp User',
              password_hash: 'hashed',
              must_change_password: true,
            },
            error: null,
          })
        )
        .mockReturnValueOnce(makeChain({ data: null, error: null }))

      const res = await POST(makeRequest({ email: 'temp@x.com', password: 'TempPassword123!' }))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.mustChangePassword).toBe(true)
    })
  })
})

describe('GET /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('预热登录 route 和主登录 RPC 无副作用分支', async () => {
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: {}, error: null })

    const res = await GET(makeGetRequest({ 'x-login-prewarm': '1' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(res.headers.get('X-Login-Prewarm')).toBe('1')
    expect(res.headers.get('X-Login-Prewarm-Timing')).toContain('login_rpc')
    expect(res.headers.get('X-Login-Prewarm-Timing')).not.toContain('users_query')
    expect(res.headers.get('X-Login-Prewarm-Timing')).not.toContain('candidate_rpc')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'login_with_password_v1',
      expect.objectContaining({
        p_email: null,
        p_phone: null,
        p_password: null,
        p_ip_address: 'prewarm',
        p_token_id: null,
        p_token: null,
        p_expires_at: null,
      })
    )
  })

  it('预热失败仍返回成功', async () => {
    ;(supabaseAdmin.rpc as any).mockImplementation(() => {
      throw new Error('prewarm failed')
    })

    const res = await GET(makeGetRequest({ 'x-login-prewarm': '1' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
  })

  it('预热外部等待超时时仍快速返回并记录阶段', async () => {
    process.env.LOGIN_PREWARM_TASK_TIMEOUT_MS = '1'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    ;(supabaseAdmin.rpc as any).mockReturnValue(new Promise(() => undefined))

    try {
      const res = await GET(makeGetRequest({ 'x-login-prewarm': '1' }))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.ok).toBe(true)
      expect(res.headers.get('X-Login-Prewarm-Timing')).toContain('login_rpc')
      expect(res.headers.get('X-Login-Prewarm-Timing')).toContain('timed_out')
      expect(warn).toHaveBeenCalledWith('[auth/login] prewarm timeout', expect.objectContaining({
        timeoutMs: 1,
        tasks: expect.arrayContaining([
          expect.objectContaining({ name: 'login_rpc' }),
        ]),
      }))
    } finally {
      delete process.env.LOGIN_PREWARM_TASK_TIMEOUT_MS
      warn.mockRestore()
    }
  })

  it('缺少预热 header 时不访问数据库', async () => {
    const res = await GET(makeGetRequest())

    expect(res.status).toBe(204)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})
