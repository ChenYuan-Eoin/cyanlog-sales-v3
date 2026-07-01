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
import { supabaseAdmin } from '@/lib/supabase'

const originalFeishuAppId = process.env.FEISHU_APP_ID
const originalFeishuAppSecret = process.env.FEISHU_APP_SECRET

function makeRequest(): any {
  return new Request('https://example.test/api/access/feishu/sync', { method: 'POST' })
}

function makeThenableQuery(result: unknown): any {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
      Promise.resolve(result).then(resolve, reject)
    ),
  }
  return query
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
    expect(body.scope).toBe('departments_and_members')
    expect(body.missing).toEqual(['FEISHU_APP_ID', 'FEISHU_APP_SECRET'])
    expect(body.hint).toContain('Vercel')
    expect(body.hint).toContain('成员读取权限')
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
    expect(body.scope).toBe('departments_and_members')
    expect(body.error).toBe('invalid app')
    consoleError.mockRestore()
  })

  it('请求飞书部门列表时使用不超过上游限制的 page_size', async () => {
    process.env.FEISHU_APP_ID = 'app-id'
    process.env.FEISHU_APP_SECRET = 'app-secret'
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        tenant_access_token: 'tenant-token',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 999,
        msg: 'department failed',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    await POST(makeRequest())

    const departmentUrl = new URL(String(fetchMock.mock.calls[1][0]))
    expect(departmentUrl.searchParams.get('page_size')).toBe('50')
    consoleError.mockRestore()
  })

  it('飞书只返回 root 或 0 个部门时返回 partial 而不是 completed', async () => {
    process.env.FEISHU_APP_ID = 'app-id'
    process.env.FEISHU_APP_SECRET = 'app-secret'
    vi.mocked(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'departments') {
        return makeThenableQuery({ data: [], error: null })
      }
      if (table === 'users') {
        return makeThenableQuery({ data: [], error: null })
      }
      return makeThenableQuery({ data: [], error: null })
    })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        tenant_access_token: 'tenant-token',
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        data: {
          items: [],
          has_more: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 0,
        msg: 'ok',
        data: {
          items: [],
          has_more: false,
        },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    )

    const res = await POST(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(false)
    expect(body.sync_status).toBe('partial')
    expect(body.message).toBe('飞书返回 0 个可访问部门')
    expect(body.departments.failed).toBe(1)
    expect(body.members.failed).toBe(0)
    expect(body.warnings[0].message).toContain('0 个可访问部门')
  })
})
