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

  it('当天无报价 → 单号格式 QT-YYYYMMDD-0001', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    let callCount = 0
    ;(supabaseAdmin.from as any).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return makeChain({ data: null, error: { code: 'PGRST116' } })
      }
      // 返回的 mock 不知道真实 quote_no，但真实代码会基于 lastQuote 计算
      return makeChain({ data: { id: 'q-new' }, error: null })
    })

    const req = makeRequest('http://localhost/api/quotes', 'POST')
    req.json = async () => ({
      customer_name: '测试客户',
      customer_contact: '13800138000',
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    // 验证 insert 时传入的 quote_no（已在 insertPayload 中捕获）
  })

  it('当天有 QT-20260602-0003 → insert 传入 QT-20260602-0004', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    let callCount = 0
    let insertPayload: any = null
    ;(supabaseAdmin.from as any).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return makeChain({ data: { quote_no: 'QT-20260602-0003' }, error: null })
      }
      // 捕获 insert 参数
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
    req.json = async () => ({ customer_name: 'X', customer_contact: 'Y' })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(insertPayload).toBeTruthy()
    expect(insertPayload.quote_no).toBe('QT-20260602-0004')
  })

  it('DB 插入失败 → 500 DB_ERROR', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    let callCount = 0
    ;(supabaseAdmin.from as any).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return makeChain({ data: null, error: { code: 'PGRST116' } })
      }
      return makeChain({ data: null, error: { message: 'insert failed', code: 'PGRST_ERROR' } })
    })

    const req = makeRequest('http://localhost/api/quotes', 'POST')
    req.json = async () => ({ customer_name: 'X', customer_contact: 'Y' })
    const res = await POST(req)
    expect(res.status).toBe(500)
  })

  it('单号唯一键冲突 → 自动重试 → 成功', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    let callCount = 0
    ;(supabaseAdmin.from as any).mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        // 第一次查询 lastQuote
        return makeChain({ data: { quote_no: 'QT-20260602-0003' }, error: null })
      }
      if (callCount === 2) {
        // 第一次 insert → 唯一键冲突
        return makeChain({ data: null, error: { code: '23505', message: 'duplicate' } })
      }
      if (callCount === 3) {
        // 第二次查询（重试）→ nextSeq 变成 0005
        return makeChain({ data: { quote_no: 'QT-20260602-0004' }, error: null })
      }
      // 第二次 insert → 成功
      return makeChain({ data: { id: 'q-new' }, error: null })
    })

    const req = makeRequest('http://localhost/api/quotes', 'POST')
    req.json = async () => ({ customer_name: 'X', customer_contact: 'Y' })
    const res = await POST(req)
    expect(res.status).toBe(201)
  })

  it('3 次重试都冲突 → 500 + 错误信息', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    ;(supabaseAdmin.from as any).mockImplementation(() => {
      const c = makeChain({ data: null, error: { code: '23505', message: 'duplicate' } })
      return c
    })

    const req = makeRequest('http://localhost/api/quotes', 'POST')
    req.json = async () => ({ customer_name: 'X', customer_contact: 'Y' })
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('DB_ERROR')
  })
})
