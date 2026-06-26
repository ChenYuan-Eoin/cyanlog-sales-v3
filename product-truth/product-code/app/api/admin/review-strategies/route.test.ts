/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
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
