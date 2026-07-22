/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth')>()
  return {
    ...actual,
    getAuthUser: vi.fn(),
    requireAuth: vi.fn(),
  }
})

import {
  AuthDependencyError,
  AuthError,
  getAuthUser,
  requireAuth,
} from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import {
  authenticationErrorResponse,
  withAuth,
  withAuthAndOrg,
  withOptionalAuth,
  withPermission,
} from './auth-wrapper'

const request = {} as NextRequest
const user = {
  id: 'user-1',
  email: 'preview@example.com',
  phone: null,
  display_name: 'Preview User',
}

async function readError(response: Response) {
  return await response.json() as {
    success: false
    error: { code: string; message: string }
  }
}

describe('API auth wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('无效登录态仍返回 401', async () => {
    ;(requireAuth as any).mockRejectedValue(new AuthError())

    const response = await withAuth(request, async () => new Response('unexpected'))

    expect(response.status).toBe(401)
    expect((await readError(response)).error.code).toBe('A001')
  })

  it('认证依赖故障返回可重试的 503，而不是 401', async () => {
    ;(requireAuth as any).mockRejectedValue(new AuthDependencyError())

    const response = await withAuth(request, async () => new Response('unexpected'))

    expect(response.status).toBe(503)
    const body = await readError(response)
    expect(body.error.code).toBe('S003')
    expect(body.error.message).toContain('身份服务暂时不可用')
  })

  it('路由可复用认证错误映射，未知业务异常不被误判', async () => {
    expect(authenticationErrorResponse(new AuthError())?.status).toBe(401)
    expect(authenticationErrorResponse(new AuthDependencyError())?.status).toBe(503)
    expect(authenticationErrorResponse(new Error('business failure'))).toBeNull()
  })

  it('默认组织查询故障同样返回 503', async () => {
    ;(requireAuth as any).mockResolvedValue(user)
    ;(supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      abortSignal: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'fetch failed' },
      }),
    })

    const response = await withAuthAndOrg(
      request,
      async () => new Response('unexpected')
    )

    expect(response.status).toBe(503)
    expect((await readError(response)).error.code).toBe('S003')
  })

  it('认证和默认组织有效时执行处理器', async () => {
    ;(requireAuth as any).mockResolvedValue(user)
    ;(supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      abortSignal: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { org_id: 'org-1' },
        error: null,
      }),
    })

    const response = await withAuthAndOrg(
      request,
      async (authenticatedUser, orgId) => Response.json({
        userId: authenticatedUser.id,
        orgId,
      })
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ userId: 'user-1', orgId: 'org-1' })
  })

  it('withAuth 的业务异常只抛出一次，不会被改写成 401', async () => {
    ;(requireAuth as any).mockResolvedValue(user)
    const sentinel = new Error('business failure')
    const handler = vi.fn(async () => {
      throw sentinel
    })

    await expect(withAuth(request, handler)).rejects.toBe(sentinel)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('withAuthAndOrg 的业务异常不会被认证 catch 吞掉', async () => {
    ;(requireAuth as any).mockResolvedValue(user)
    ;(supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      abortSignal: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { org_id: 'org-1' },
        error: null,
      }),
    })
    const sentinel = new Error('route failure')
    const handler = vi.fn(async () => {
      throw sentinel
    })

    await expect(withAuthAndOrg(request, handler)).rejects.toBe(sentinel)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('可选认证依赖故障时 fail closed，且不以匿名身份重跑处理器', async () => {
    ;(getAuthUser as any).mockRejectedValue(new AuthDependencyError())
    const handler = vi.fn(async () => new Response('unexpected'))

    const response = await withOptionalAuth(request, handler)

    expect(response).toBeInstanceOf(Response)
    expect((response as Response).status).toBe(503)
    expect(handler).not.toHaveBeenCalled()
  })

  it('可选认证的业务异常只执行一次', async () => {
    ;(getAuthUser as any).mockResolvedValue(null)
    const sentinel = new Error('optional handler failure')
    const handler = vi.fn(async () => {
      throw sentinel
    })

    await expect(withOptionalAuth(request, handler)).rejects.toBe(sentinel)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('权限包装器的业务异常不会被改写成 401', async () => {
    ;(requireAuth as any).mockResolvedValue(user)
    const sentinel = new Error('permission handler failure')
    const handler = vi.fn(async () => {
      throw sentinel
    })

    await expect(withPermission(request, 'contract:review', handler)).rejects.toBe(sentinel)
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
