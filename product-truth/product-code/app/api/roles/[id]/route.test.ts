/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { PATCH } from './route'

function makeMalformedRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'PATCH',
    headers: new Headers({
      'content-type': 'application/json',
      'x-user-permissions': 'config:write',
    }),
  }
}

describe('PATCH /api/roles/[id] validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('无效 JSON 返回参数错误且不访问数据库', async () => {
    const res = await PATCH(makeMalformedRequest(), {
      params: Promise.resolve({ id: 'role-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('INVALID_BODY')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
