// 测试 app/api/cases/route.ts
// 覆盖：列表分页、过滤、创建、参数验证

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

import { requireAuth } from '@/lib/auth'
import { GET, POST } from './route'

function makeRequest(url: string, body?: any, method = 'GET'): any {
  return {
    url,
    method,
    json: async () => body || {},
    headers: new Headers(),
  }
}

function makeChain(rangeResult: any) {
  const chain: any = {}
  ;['select', 'eq', 'or', 'order', 'range'].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain)
  })
  chain.range = vi.fn().mockResolvedValue(rangeResult)
  return chain
}

describe('GET /api/cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('未登录 → 401', async () => {
    const err = new Error('Unauthorized')
    err.name = 'AuthError'
    ;(requireAuth as any).mockRejectedValue(err)
    const res = await GET(makeRequest('http://localhost/api/cases'))
    expect(res.status).toBe(401)
  })

  it('正常查询 → 200 含 data + meta', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    ;(supabaseAdmin.from as any).mockReturnValue(
      makeChain({ data: [{ id: 'c1' }], error: null, count: 1 })
    )

    const res = await GET(makeRequest('http://localhost/api/cases?page=1&pageSize=20'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data).toHaveLength(1)
    expect(body.meta.total).toBe(1)
    expect(body.meta.page).toBe(1)
  })

  it('按 outcome 过滤', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    const chain = makeChain({ data: [], error: null, count: 0 })
    ;(supabaseAdmin.from as any).mockReturnValue(chain)

    const res = await GET(makeRequest('http://localhost/api/cases?outcome=SUCCESS'))
    expect(res.status).toBe(200)
    // 验证 eq 被调用
    expect(chain.eq).toHaveBeenCalledWith('outcome', 'SUCCESS')
  })

  it('按行业 + 产品双过滤', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    const chain = makeChain({ data: [], error: null, count: 0 })
    ;(supabaseAdmin.from as any).mockReturnValue(chain)

    const res = await GET(makeRequest('http://localhost/api/cases?industry=金融&product=AI'))
    expect(res.status).toBe(200)
    expect(chain.eq).toHaveBeenCalledWith('industry', '金融')
    expect(chain.eq).toHaveBeenCalledWith('product', 'AI')
  })

  it('按 search 关键词模糊查询', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    const chain = makeChain({ data: [], error: null, count: 0 })
    ;(supabaseAdmin.from as any).mockReturnValue(chain)

    const res = await GET(makeRequest('http://localhost/api/cases?search=银行'))
    expect(res.status).toBe(200)
    expect(chain.or).toHaveBeenCalledWith(expect.stringContaining('银行'))
  })

  it('DB 错误 → 500 DB_ERROR', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    const chain = makeChain({ data: null, error: { message: 'DB down' }, count: 0 })
    ;(supabaseAdmin.from as any).mockReturnValue(chain)

    const res = await GET(makeRequest('http://localhost/api/cases'))
    expect(res.status).toBe(500)
  })

  it('无效 outcome 枚举 → 400', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const res = await GET(makeRequest('http://localhost/api/cases?outcome=INVALID'))
    expect(res.status).toBe(400)
  })
})

describe('POST /api/cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('缺 title → 400', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const res = await POST(
      makeRequest('http://localhost/api/cases', { customer_name: 'X', industry: '金融', product: 'AI', outcome: 'SUCCESS' })
    )
    expect(res.status).toBe(400)
  })

  it('缺 outcome → 400', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const res = await POST(
      makeRequest('http://localhost/api/cases', { title: '案例', customer_name: 'X', industry: '金融', product: 'AI' })
    )
    expect(res.status).toBe(400)
  })

  it('无效 outcome 枚举 → 400', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const res = await POST(
      makeRequest('http://localhost/api/cases', {
        title: '案例', customer_name: 'X', industry: '金融', product: 'AI', outcome: 'INVALID',
      })
    )
    expect(res.status).toBe(400)
  })

  it('正常创建 → 201', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    const chain: any = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'c-new' }, error: null }),
    }
    ;(supabaseAdmin.from as any).mockReturnValue(chain)

    const res = await POST(
      makeRequest('http://localhost/api/cases', {
        title: '测试案例', customer_name: '测试客户', industry: '金融', product: 'AI', outcome: 'SUCCESS',
      })
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.id).toBe('c-new')
  })

  it('DB 错误 → 500', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    const chain: any = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { message: 'insert failed' } }),
    }
    ;(supabaseAdmin.from as any).mockReturnValue(chain)

    const res = await POST(
      makeRequest('http://localhost/api/cases', {
        title: '测试', customer_name: 'X', industry: '金融', product: 'AI', outcome: 'SUCCESS',
      })
    )
    expect(res.status).toBe(500)
  })

  it('tags 超过 20 个 → 400', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const res = await POST(
      makeRequest('http://localhost/api/cases', {
        title: '案例', customer_name: 'X', industry: '金融', product: 'AI', outcome: 'SUCCESS',
        tags: Array.from({ length: 25 }, (_, i) => `t${i}`),
      })
    )
    expect(res.status).toBe(400)
  })
})
