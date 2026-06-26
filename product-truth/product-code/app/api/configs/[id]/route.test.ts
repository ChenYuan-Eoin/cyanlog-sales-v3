/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { PUT } from './route'

function makeMalformedJsonRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'PUT',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeQueryResult(data: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error: null }),
  }
}

describe('PUT /api/configs/[id] validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
  })

  it('无效 JSON 返回参数错误且不执行配置更新', async () => {
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(makeQueryResult({ org_id: 'org-1' }))
      .mockReturnValueOnce(makeQueryResult({ id: 'config-1', type: 'UI_THEME', value: {} }))

    const res = await PUT(makeMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'config-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
    expect(supabaseAdmin.from).not.toHaveBeenCalledWith('config_versions')
  })
})
