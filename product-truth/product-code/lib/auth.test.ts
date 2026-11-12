// 测试 lib/auth.ts
// 重点：getAuthUser / requireAuth 行为

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { getAuthUser, requireAuth, AuthError, sanitizeFileName } from './auth'

function makeReq(headers: Record<string, string> = {}, cookies: Record<string, string> = {}): NextRequest {
  const h = new Headers(headers)
  const req = {
    headers: h,
    cookies: {
      get: (name: string) => (cookies[name] ? { value: cookies[name] } : undefined),
    },
  } as unknown as NextRequest
  return req
}

describe('Auth Module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getAuthUser', () => {
    it.each([
      ['authoritative', true],
      ['evidence', false],
    ] as const)('checks current Fxiaoke identity authority for an SSO token: %s', async (identityAuthority, allowed) => {
      ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
        if (table === 'auth_tokens') return {
          select: () => ({ eq: () => ({ single: async () => ({
            data: {
              user_id: 'sso-user', auth_method: 'fxiaoke', expires_at: null,
              user: { id: 'sso-user', org_id: 'org-1', status: 'active', login_enabled: true },
            }, error: null,
          }) }) }),
        }
        if (table === 'organization_sources') return {
          select: () => ({ eq: () => query }),
        }
        if (table === 'user_organizations') return {
          select: () => ({ eq: () => membership }),
        }
        throw new Error(`unexpected table ${table}`)
      })
      const query = {
        eq: () => query,
        limit: async () => ({ data: [{
          authority_scope: { identity: identityAuthority },
          connection_state: 'verified', effective_revision: 'revision-1',
        }], error: null }),
      }
      const membership = {
        eq: () => membership,
        maybeSingle: async () => ({ data: { org_id: 'org-1', employment_status: 'active' }, error: null }),
      }

      const user = await getAuthUser(makeReq({ authorization: 'Bearer sso-token' }))
      expect(Boolean(user)).toBe(allowed)
    })

    it('rejects an existing Fxiaoke session after employment is suspended', async () => {
      ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
        if (table === 'auth_tokens') return {
          select: () => ({ eq: () => ({ single: async () => ({
            data: { user_id: 'sso-user', auth_method: 'fxiaoke', expires_at: null,
              user: { id: 'sso-user', org_id: 'org-1', status: 'active', login_enabled: true } },
            error: null,
          }) }) }),
        }
        if (table === 'organization_sources') return { select: () => ({ eq: () => source }) }
        if (table === 'user_organizations') return { select: () => ({ eq: () => membership }) }
        throw new Error(`unexpected table ${table}`)
      })
      const source = { eq: () => source, limit: async () => ({ data: [{
        authority_scope: { identity: 'authoritative' }, connection_state: 'verified', effective_revision: 'revision-1',
      }], error: null }) }
      const membership = { eq: () => membership, maybeSingle: async () => ({
        data: { org_id: 'org-1', employment_status: 'suspended' }, error: null,
      }) }

      expect(await getAuthUser(makeReq({ authorization: 'Bearer sso-token' }))).toBeNull()
    })

    it('无 token 时返回 null', async () => {
      const user = await getAuthUser(makeReq())
      expect(user).toBeNull()
    })

    it('Authorization Bearer 头可被识别', async () => {
      // 第一次查询 auth_tokens
      ;(supabaseAdmin.from as any)
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { user_id: 'u1', expires_at: null },
            error: null,
          }),
        })
        // 第二次查询 users
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'u1', email: 'test@test.com', status: 'active', login_enabled: true },
            error: null,
          }),
        })

      const req = makeReq({ authorization: 'Bearer abc123' })
      const user = await getAuthUser(req)
      expect(user).not.toBeNull()
      expect(user?.id).toBe('u1')
    })

    it('Cookie 中的 token 也可被识别', async () => {
      ;(supabaseAdmin.from as any)
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { user_id: 'u2', expires_at: null },
            error: null,
          }),
        })
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'u2', status: 'active', login_enabled: true },
            error: null,
          }),
        })

      const req = makeReq({}, { token: 'cookie-token' })
      const user = await getAuthUser(req)
      expect(user?.id).toBe('u2')
    })

    it('客户端回退 cookie 中的 token 也可被识别', async () => {
      ;(supabaseAdmin.from as any)
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { user_id: 'u3', expires_at: null },
            error: null,
          }),
        })
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'u3', status: 'active', login_enabled: true },
            error: null,
          }),
        })

      const req = makeReq({}, { client_token: 'client-cookie-token' })
      const user = await getAuthUser(req)
      expect(user?.id).toBe('u3')
    })

    it('token 已过期时返回 null', async () => {
      ;(supabaseAdmin.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { user_id: 'u1', expires_at: '2020-01-01T00:00:00Z' },
          error: null,
        }),
      })

      const user = await getAuthUser(makeReq({ authorization: 'Bearer expired' }))
      expect(user).toBeNull()
    })

    it('token 不存在时返回 null', async () => {
      ;(supabaseAdmin.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: { message: 'not found' } }),
      })

      const user = await getAuthUser(makeReq({ authorization: 'Bearer invalid' }))
      expect(user).toBeNull()
    })

    it('token 有效但用户已停用时返回 null', async () => {
      ;(supabaseAdmin.from as any).mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            user_id: 'u-disabled',
            expires_at: null,
            user: {
              id: 'u-disabled',
              status: 'suspended',
              login_enabled: false,
            },
          },
          error: null,
        }),
      })

      const user = await getAuthUser(makeReq({ authorization: 'Bearer disabled-token' }))

      expect(user).toBeNull()
      expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
    })
  })

  describe('requireAuth', () => {
    it('未认证时抛出 AuthError', async () => {
      const req = makeReq()
      await expect(requireAuth(req)).rejects.toThrow(AuthError)
    })

    it('已认证时返回 user', async () => {
      ;(supabaseAdmin.from as any)
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { user_id: 'u1', expires_at: null },
            error: null,
          }),
        })
        .mockReturnValueOnce({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'u1', email: 'a@b.com', status: 'active', login_enabled: true },
            error: null,
          }),
        })

      const user = await requireAuth(makeReq({ authorization: 'Bearer abc' }))
      expect(user.id).toBe('u1')
    })
  })

  describe('sanitizeFileName', () => {
    it('替换不安全字符为下划线', () => {
      expect(sanitizeFileName('hello world.txt')).toBe('hello_world.txt')
    })

    it('合并连续下划线', () => {
      expect(sanitizeFileName('a   b___c.txt')).toBe('a_b_c.txt')
    })

    it('截断超过 255 字符的文件名', () => {
      const long = 'a'.repeat(300) + '.txt'
      const result = sanitizeFileName(long)
      expect(result.length).toBeLessThanOrEqual(255)
    })

    it('保留扩展名', () => {
      expect(sanitizeFileName('test.pdf')).toBe('test.pdf')
    })

    it('处理空字符串', () => {
      expect(sanitizeFileName('')).toBe('')
    })
  })
})
