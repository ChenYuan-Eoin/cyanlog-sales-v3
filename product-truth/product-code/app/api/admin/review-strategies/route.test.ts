/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: vi.fn(),
}))

vi.mock('@/lib/configs/access', () => ({
  userHasFreshOrgConfigAccess: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
import { userHasFreshOrgConfigAccess } from '@/lib/configs/access'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

function makeMalformedRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeJsonRequest(body: unknown): any {
  return {
    json: async () => body,
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('POST /api/admin/review-strategies validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
    ;(userHasFreshOrgConfigAccess as any).mockResolvedValue(true)
  })

  it('没有当前组织 config:write 时拒绝保存策略，且不解析请求或访问数据库', async () => {
    ;(userHasFreshOrgConfigAccess as any).mockResolvedValue(false)
    const json = vi.fn().mockResolvedValue({ code: 'BALANCED', name: '平衡策略' })

    const res = await POST({
      json,
      method: 'POST',
      headers: new Headers({ 'content-type': 'application/json' }),
    } as any)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('NO_PERMISSION')
    expect(userHasFreshOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'write')
    expect(json).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('当前组织 config:write 可以保存当前组织审核策略', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'strategy-1' }, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const upsert = vi.fn().mockReturnValue({ select })
    ;(supabaseAdmin.from as any).mockReturnValue({ upsert })

    const res = await POST(makeJsonRequest({ code: 'BALANCED', name: '平衡策略' }))

    expect(res.status).toBe(200)
    expect(userHasFreshOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'write')
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      org_id: 'org-1',
      code: 'BALANCED',
      name: '平衡策略',
    }), { onConflict: 'org_id,code' })
  })

  it('无效 JSON 返回策略代码错误且不访问数据库', async () => {
    const res = await POST(makeMalformedRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_CODE')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('字段类型错误返回参数错误且不访问数据库', async () => {
    const res = await POST(makeJsonRequest({
      code: 'BALANCED',
      name: '平衡策略',
      risk_threshold: '50',
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_FIELDS')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
