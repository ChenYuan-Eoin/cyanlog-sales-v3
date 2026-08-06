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
import { GET } from './route'

function makeRequest(url = 'https://example.test/api/agenda/upcoming'): any {
  return new Request(url)
}

function makeQuery(result: any) {
  const chain: any = {}
  ;['select', 'gte', 'or', 'order'].forEach((method) => {
    chain[method] = vi.fn().mockReturnValue(chain)
  })
  chain.limit = vi.fn().mockResolvedValue(result)
  return chain
}

describe('GET /api/agenda/upcoming', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'u-1' })
  })

  it('未登录 → 401', async () => {
    const authError = new Error('unauthorized')
    authError.name = 'AuthError'
    ;(requireAuth as any).mockRejectedValue(authError)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error.code).toBe('A001')
  })

  it('非法查询参数 → 400', async () => {
    const res = await GET(makeRequest('https://example.test/api/agenda/upcoming?limit=999'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('只返回当前用户相关日程', async () => {
    const query = makeQuery({ data: [{ id: 'a-1', title: 'Demo' }], error: null })
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'agenda_dependencies') {
        const depsChain: any = {}
        depsChain.select = vi.fn().mockReturnValue(depsChain)
        depsChain.in = vi.fn().mockResolvedValue({ data: [], error: null })
        return depsChain
      }
      return query
    })

    const res = await GET(makeRequest('https://example.test/api/agenda/upcoming?limit=20'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(supabaseAdmin.from).toHaveBeenCalledWith('agenda_items')
    expect(supabaseAdmin.from).toHaveBeenCalledWith('agenda_dependencies')
    expect(query.or).toHaveBeenCalledWith('user_id.eq.u-1,assignee_id.eq.u-1,created_by.eq.u-1')
    expect(query.limit).toHaveBeenCalledWith(20)
  })
})
