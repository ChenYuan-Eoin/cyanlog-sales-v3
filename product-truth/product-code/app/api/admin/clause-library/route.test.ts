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

describe('POST /api/admin/clause-library validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
    ;(userHasFreshOrgConfigAccess as any).mockResolvedValue(true)
  })

  it.each([
    '普通用户',
    '仅有 config:read 的用户',
    '仅在其他组织有 config:write 的用户',
  ])('%s 无权创建条款，且不解析请求或访问数据库', async () => {
    ;(userHasFreshOrgConfigAccess as any).mockResolvedValue(false)
    const json = vi.fn().mockResolvedValue({
      name: '付款条款',
      category: '付款',
      template_text: '合同应明确付款方式。',
    })

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

  it('当前组织 config:write 可以创建组织自有的非系统条款', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'clause-1' }, error: null })
    const select = vi.fn().mockReturnValue({ single })
    const insert = vi.fn().mockReturnValue({ select })
    ;(supabaseAdmin.from as any).mockReturnValue({ insert })

    const res = await POST(makeJsonRequest({
      name: '付款条款',
      category: '付款',
      template_text: '合同应明确付款方式。',
    }))

    expect(res.status).toBe(200)
    expect(userHasFreshOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'write')
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      org_id: 'org-1',
      created_by: 'user-1',
      is_system: false,
    }))
  })

  it('无效 JSON 返回缺字段错误且不访问数据库', async () => {
    const res = await POST(makeMalformedRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('MISSING_FIELDS')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('立场值错误返回参数错误且不访问数据库', async () => {
    const res = await POST(makeJsonRequest({
      name: '付款条款',
      category: '付款',
      template_text: '合同应明确付款方式。',
      stance: 'invalid',
    }))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_STANCE')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
