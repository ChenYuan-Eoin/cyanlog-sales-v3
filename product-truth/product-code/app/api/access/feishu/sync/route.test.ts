/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  canManageOrg: vi.fn(),
  getDefaultOrgId: vi.fn(),
  getUserScopedRoleAssignments: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
import { canManageOrg, getDefaultOrgId, getUserScopedRoleAssignments } from '@/lib/scoped-access'
import { POST } from './route'

const originalFeishuAppId = process.env.FEISHU_APP_ID
const originalFeishuAppSecret = process.env.FEISHU_APP_SECRET

function makeRequest(): any {
  return new Request('https://example.test/api/access/feishu/sync', { method: 'POST' })
}

function restoreFeishuEnv() {
  if (originalFeishuAppId === undefined) {
    delete process.env.FEISHU_APP_ID
  } else {
    process.env.FEISHU_APP_ID = originalFeishuAppId
  }

  if (originalFeishuAppSecret === undefined) {
    delete process.env.FEISHU_APP_SECRET
  } else {
    process.env.FEISHU_APP_SECRET = originalFeishuAppSecret
  }
}

describe('POST /api/access/feishu/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.FEISHU_APP_ID
    delete process.env.FEISHU_APP_SECRET
    ;(requireAuth as any).mockResolvedValue({ id: 'u-1' })
    ;(getUserScopedRoleAssignments as any).mockResolvedValue([])
    ;(canManageOrg as any).mockReturnValue(true)
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    restoreFeishuEnv()
  })

  it('未登录时返回标准鉴权错误', async () => {
    const authError = new Error('unauthorized')
    authError.name = 'AuthError'
    ;(requireAuth as any).mockRejectedValue(authError)

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ code: 'UNAUTHORIZED', error: '未登录或登录已过期' })
  })

  it('缺少组织管理权限时返回可识别错误码', async () => {
    ;(canManageOrg as any).mockReturnValue(false)

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('FORBIDDEN')
    expect(body.error).toBe('需要组织管理员权限')
  })

  it('飞书凭据未配置时返回同步范围和缺失项', async () => {
    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.code).toBe('FEISHU_NOT_CONFIGURED')
    expect(body.connector).toBe('feishu')
    expect(body.scope).toBe('departments')
    expect(body.missing).toEqual(['FEISHU_APP_ID', 'FEISHU_APP_SECRET'])
    expect(body.hint).toContain('Vercel')
    expect(body.hint).toContain('仅同步部门结构')
  })

  it('飞书上游失败时保留同步域上下文', async () => {
    process.env.FEISHU_APP_ID = 'app-id'
    process.env.FEISHU_APP_SECRET = 'app-secret'
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 999, msg: 'invalid app' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    ))

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(502)
    expect(body.code).toBe('FEISHU_SYNC_FAILED')
    expect(body.connector).toBe('feishu')
    expect(body.scope).toBe('departments')
    expect(body.error).toBe('invalid app')
    consoleError.mockRestore()
  })
})
