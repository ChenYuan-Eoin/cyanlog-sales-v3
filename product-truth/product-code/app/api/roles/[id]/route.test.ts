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

function makeJsonRequest(body: unknown): any {
  return {
    json: async () => body,
    method: 'PATCH',
    headers: new Headers({
      'content-type': 'application/json',
      'x-user-permissions': 'config:write',
    }),
  }
}

function makeUpdateChain(result: any) {
  const chain: any = {}
  chain.update = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.select = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue(result)
  return chain
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
    expect(body.error.code).toBe('V001')
    expect(body.error.message).toBe('INVALID_BODY')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('更新成功返回 common success envelope', async () => {
    const role = { id: 'role-1', permissions: ['config:read'] }
    const query = makeUpdateChain({ data: role, error: null })
    ;(supabaseAdmin.from as any).mockReturnValue(query)

    const res = await PATCH(makeJsonRequest({ permissions: ['config:read'] }), {
      params: Promise.resolve({ id: 'role-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      data: role,
    })
    expect(supabaseAdmin.from).toHaveBeenCalledWith('roles')
    expect(query.update).toHaveBeenCalledWith({ permissions: ['config:read'] })
    expect(query.eq).toHaveBeenCalledWith('id', 'role-1')
  })
})
