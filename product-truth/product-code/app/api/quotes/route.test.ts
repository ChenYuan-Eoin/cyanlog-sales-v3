// 测试 app/api/quotes/route.ts
// 覆盖：GET 列表/分页、POST 创建（含单号生成）

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
import { supabaseAdmin } from '@/lib/supabase'
import { GET, POST } from './route'

function makeRequest(url: string, method = 'GET'): any {
  return {
    url,
    method,
    json: async () => ({}),
    headers: new Headers(),
  }
}

function makeChain(result: any) {
  const chain: any = {}
  ;['select', 'eq', 'neq', 'order', 'like', 'limit', 'range', 'insert'].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain)
  })
  chain.single = vi.fn().mockResolvedValue(result)
  return chain
}

describe('GET /api/quotes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('未登录 → 401', async () => {
    const err = new Error('Unauthorized')
    err.name = 'AuthError'
    ;(requireAuth as any).mockRejectedValue(err)
    const res = await GET(makeRequest('http://localhost/api/quotes'))
    expect(res.status).toBe(401)
  })

  it('无效分页参数 → 400', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const res = await GET(makeRequest('http://localhost/api/quotes?page=abc'))
    expect(res.status).toBe(400)
  })

  it('正常查询 → 200 with data + meta', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    const chain = makeChain({ data: [{ id: 'q1' }], error: null })
    // range() 返回完整响应（含 count）
    chain.range = vi.fn().mockResolvedValue({ data: [{ id: 'q1' }], error: null, count: 1 })
    ;(supabaseAdmin.from as any).mockReturnValue(chain)

    const res = await GET(makeRequest('http://localhost/api/quotes?page=1&pageSize=20'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data).toHaveLength(1)
    expect(body.meta.page).toBe(1)
    expect(body.meta.pageSize).toBe(20)
  })

  it('DB 错误 → 500 DB_ERROR', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    const chain = makeChain({ data: null, error: null })
    // 让 range() 抛错
    chain.range = vi.fn().mockResolvedValue({ data: null, error: { message: 'DB down' } })
    ;(supabaseAdmin.from as any).mockReturnValue(chain)

    const res = await GET(makeRequest('http://localhost/api/quotes?page=1&pageSize=20'))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/quotes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('参数验证失败 → 400', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const req = makeRequest('http://localhost/api/quotes', 'POST')
    req.json = async () => ({}) // 缺字段
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('序列成功 → insert 传入生成的单号', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    ;(supabaseAdmin as any).rpc = vi.fn().mockResolvedValue({
      data: 'QT-20260603-0001',
      error: null,
    })
    let insertPayload: any = null
    ;(supabaseAdmin.from as any).mockImplementation(() => {
      const chain: any = {
        insert: vi.fn((payload: any) => {
          insertPayload = payload
          return chain
        }),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: { id: 'q-new' }, error: null }),
      }
      return chain
    })

    const req = makeRequest('http://localhost/api/quotes', 'POST')
    req.json = async () => ({
      customer_name: '测试客户',
      customer_contact: '13800138000',
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(insertPayload).toBeTruthy()
    expect(insertPayload.quote_no).toBe('QT-20260603-0001')
  })

  it('序列生成失败 → 500 SEQUENCE_ERROR', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    ;(supabaseAdmin as any).rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'sequence unavailable' },
    })

    const req = makeRequest('http://localhost/api/quotes', 'POST')
    req.json = async () => ({ customer_name: 'X', customer_contact: 'Y' })
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('SEQUENCE_ERROR')
  })

  it('DB 插入失败 → 500 DB_ERROR', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    ;(supabaseAdmin as any).rpc = vi.fn().mockResolvedValue({
      data: 'QT-20260603-0002',
      error: null,
    })
    ;(supabaseAdmin.from as any).mockImplementation(() => {
      const chain: any = {
        insert: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'insert failed', code: 'PGRST_ERROR' },
        }),
      }
      return chain
    })

    const req = makeRequest('http://localhost/api/quotes', 'POST')
    req.json = async () => ({ customer_name: 'X', customer_contact: 'Y' })
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('DB_ERROR')
  })
})
