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
import { PATCH } from './route'

function makeMalformedRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'PATCH',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeJsonRequest(body: unknown): any {
  return {
    json: async () => body,
    method: 'PATCH',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('PATCH /api/admin/clause-library/[id] validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
  })

  it('无效 JSON 返回参数错误且不访问数据库', async () => {
    const res = await PATCH(makeMalformedRequest(), {
      params: Promise.resolve({ id: 'clause-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_FIELDS')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('立场值错误返回参数错误且不访问数据库', async () => {
    const res = await PATCH(makeJsonRequest({ stance: 'invalid' }), {
      params: Promise.resolve({ id: 'clause-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_STANCE')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
