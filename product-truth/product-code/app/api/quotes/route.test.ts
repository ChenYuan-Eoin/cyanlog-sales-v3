// 测试 app/api/quotes/route.ts
// 覆盖：GET 列表/分页、POST 创建（含单号生成）

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  canManageOrg: vi.fn().mockReturnValue(false),
  getDefaultOrgId: vi.fn().mockResolvedValue('org-1'),
  getUserScopedRoleAssignments: vi.fn().mockResolvedValue([]),
  listAccessibleUserIds: vi.fn().mockResolvedValue({ userIds: ['u1'] }),
}))

vi.mock('@/lib/pricing/service', () => ({
  calculateQuoteDraft: vi.fn().mockResolvedValue({
    items: [{
      product_id: '11111111-1111-4111-8111-111111111111',
      product_type: 'sku',
      product_code: 'PROD-001',
      name: '智能合同审核系统',
      specification: '企业版',
      unit: '套',
      quantity: 2,
      unit_price: 98000,
      discount: 0,
      line_total: 196000,
      sort_order: 0,
      pricing_source: 'tier',
      tier_range: '1-10',
    }],
    subtotal: 196000,
    discountRate: 0,
    discountAmount: 0,
    taxRate: 0.13,
    taxAmount: 25480,
    totalAmount: 221480,
  }),
}))

import { requireAuth } from '@/lib/auth'
import { canManageOrg, getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'
import { calculateQuoteDraft } from '@/lib/pricing/service'
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

function makeMalformedRequest(url: string): any {
  return {
    url,
    method: 'POST',
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeChain(result: any) {
  const chain: any = {}
  ;['select', 'eq', 'neq', 'order', 'like', 'limit', 'range', 'insert', 'in', 'gte', 'lte', 'ilike'].forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain)
  })
  chain.single = vi.fn().mockResolvedValue(result)
  return chain
}

describe('GET /api/quotes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(canManageOrg as any).mockReturnValue(false)
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
    expect(body.meta.limit).toBe(20)
    expect(body.meta.offset).toBe(0)
  })

  it('全组织管理角色 → 直接按 org 查询，不展开用户列表', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    ;(canManageOrg as any).mockReturnValue(true)
    const { supabaseAdmin } = await import('@/lib/supabase')
    const chain = makeChain({ data: [{ id: 'q1' }], error: null })
    chain.range = vi.fn().mockResolvedValue({ data: [{ id: 'q1' }], error: null, count: 1 })
    ;(supabaseAdmin.from as any).mockReturnValue(chain)

    const res = await GET(makeRequest('http://localhost/api/quotes?page=1&pageSize=20'))

    expect(res.status).toBe(200)
    expect(listAccessibleUserIds).not.toHaveBeenCalled()
    expect(chain.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(chain.in).not.toHaveBeenCalledWith('created_by', expect.anything())
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

  it('无效 JSON → 400 且不访问组织、定价和数据库', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })

    const res = await POST(makeMalformedRequest('http://localhost/api/quotes'))

    expect(res.status).toBe(400)
    expect(getDefaultOrgId).not.toHaveBeenCalled()
    expect(calculateQuoteDraft).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
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
    let quoteInsertPayload: any = null
    let quoteItemsPayload: any = null
    let quotesCall = 0
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'quotes') {
        quotesCall += 1
        if (quotesCall === 1) {
          const chain: any = {
            insert: vi.fn((payload: any) => {
              quoteInsertPayload = payload
              return chain
            }),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: { id: 'q-new' }, error: null }),
            delete: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
          }
          return chain
        }

        const chain: any = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: { id: 'q-new', quote_items: [] }, error: null }),
        }
        return chain
      }

      if (table === 'quote_items') {
        return {
          insert: vi.fn((payload: any) => {
            quoteItemsPayload = payload
            return Promise.resolve({ error: null })
          }),
        }
      }

      return makeChain({ data: null, error: null })
    })

    const req = makeRequest('http://localhost/api/quotes', 'POST')
    req.json = async () => ({
      customer_name: '测试客户',
      customer_contact: '13800138000',
      items: [{ product_type: 'sku', product_id: PRODUCT_ID, quantity: 2 }],
    })
    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(quoteInsertPayload).toBeTruthy()
    expect(quoteInsertPayload.quote_no).toBe('QT-20260603-0001')
    expect(quoteInsertPayload.org_id).toBe('org-1')
    expect(quoteItemsPayload).toHaveLength(1)
  })

  it('序列生成失败 → 500 INTERNAL_ERROR', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    ;(supabaseAdmin as any).rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'sequence unavailable' },
    })

    const req = makeRequest('http://localhost/api/quotes', 'POST')
    req.json = async () => ({ customer_name: 'X', customer_contact: 'Y', items: [{ product_type: 'sku', product_id: PRODUCT_ID, quantity: 1 }] })
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.code).toBe('S002')
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
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
      return chain
    })

    const req = makeRequest('http://localhost/api/quotes', 'POST')
    req.json = async () => ({ customer_name: 'X', customer_contact: 'Y', items: [{ product_type: 'sku', product_id: PRODUCT_ID, quantity: 1 }] })
    const res = await POST(req)
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error.code).toBe('S001')
  })

  it('schema drift 时回退到 legacy quotes/quote_items 字段', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    ;(supabaseAdmin as any).rpc = vi.fn().mockResolvedValue({
      data: 'QT-20260603-0003',
      error: null,
    })

    const quoteInsertPayloads: any[] = []
    const quoteItemInsertPayloads: any[] = []
    let quoteInsertAttempt = 0
    let quoteItemsAttempt = 0

    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'quotes') {
        const chain: any = {
          insert: vi.fn((payload: any) => {
            quoteInsertPayloads.push(payload)
            quoteInsertAttempt += 1
            return chain
          }),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockImplementation(() => Promise.resolve(
            quoteInsertAttempt === 1
              ? {
                data: null,
                error: {
                  code: '42703',
                  message: "Could not find the 'opportunity_id' column of 'quotes' in the schema cache",
                },
              }
              : { data: { id: 'q-compat' }, error: null }
          )),
          delete: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
        }
        return chain
      }

      if (table === 'quote_items') {
        return {
          insert: vi.fn((payload: any) => {
            quoteItemInsertPayloads.push(payload)
            quoteItemsAttempt += 1
            return Promise.resolve(
              quoteItemsAttempt === 1
                ? {
                  error: {
                    code: 'PGRST204',
                    message: "Could not find the 'product_id' column of 'quote_items' in the schema cache",
                  },
                }
                : { error: null }
            )
          }),
        }
      }

      return makeChain({ data: null, error: null })
    })

    const req = makeRequest('http://localhost/api/quotes', 'POST')
    req.json = async () => ({
      customer_name: '兼容客户',
      customer_contact: '13800138000',
      notes: 'legacy path',
      discount_rate: 5,
      items: [{ product_type: 'sku', product_id: PRODUCT_ID, quantity: 2 }],
    })

    const res = await POST(req)
    expect(res.status).toBe(201)
    expect(quoteInsertPayloads).toHaveLength(2)
    // 第一次 modern insert：携带新列
    expect(quoteInsertPayloads[0].discount_rate).toBe(0)
    expect(quoteInsertPayloads[0].opportunity_id).toBeNull()  // 请求未挂商机
    // 第二次 compat retry：剥离新列重试，保留 org_id 与 discount_rate（不丢字段）
    expect(quoteInsertPayloads[1].discount_rate).toBe(0)
    expect(quoteInsertPayloads[1].org_id).toBe('org-1')
    expect(quoteInsertPayloads[1].opportunity_id).toBeUndefined()  // compat 剥离新列
    expect(quoteItemInsertPayloads).toHaveLength(2)
    expect(quoteItemInsertPayloads[0][0].product_id).toBe(PRODUCT_ID)
    expect(quoteItemInsertPayloads[1][0].product_id).toBeUndefined()
    expect(quoteItemInsertPayloads[1][0].name).toBe('智能合同审核系统')
  })
})
