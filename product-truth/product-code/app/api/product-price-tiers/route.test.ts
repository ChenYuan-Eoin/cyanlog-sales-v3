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
import { PATCH, POST } from './route'

function makeMalformedRequest(method: string): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method,
    url: 'https://example.test/api/product-price-tiers',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('POST/PATCH /api/product-price-tiers validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
  })

  it('创建阶梯价无效 JSON → 400 且不访问组织和数据库', async () => {
    const res = await POST(makeMalformedRequest('POST'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_DATA')
    expect(getDefaultOrgId).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('更新阶梯价无效 JSON → 400 且不访问组织和数据库', async () => {
    const res = await PATCH(makeMalformedRequest('PATCH'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_DATA')
    expect(getDefaultOrgId).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
