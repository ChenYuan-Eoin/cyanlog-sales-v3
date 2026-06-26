// 测试 app/api/tech-documents/route.ts
// F016 技术文档库

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

function makeChain() {
  const c: any = {}
  ;['select', 'eq', 'gte', 'lte', 'order', 'range', 'or', 'ilike', 'limit', 'insert', 'update'].forEach((m) => {
    c[m] = vi.fn().mockReturnValue(c)
  })
  c.single = vi.fn()
  c.then = (resolve: any) => resolve({ data: [], error: null, count: 0 })
  return c
}

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))

import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { POST, GET } from './route'

function makeReq(body: any): any {
  return { json: async () => body, method: 'POST', url: 'http://x', headers: new Headers() }
}
function makeMalformedReq(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'POST',
    url: 'http://x',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}
function makeGetReq(url: string): any {
  return { url, method: 'GET', headers: new Headers() }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
})

describe('POST /api/tech-documents', () => {
  it('无效 JSON → 400 且不访问数据库', async () => {
    const res = await POST(makeMalformedReq())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('缺 title → 400', async () => {
    const res = await POST(makeReq({ doc_type: 'PRODUCT_SPEC' }))
    expect(res.status).toBe(400)
  })
  it('无效 doc_type → 400', async () => {
    const res = await POST(makeReq({ title: 'T', doc_type: 'BAD' }))
    expect(res.status).toBe(400)
  })
  it('无效 version 格式 → 400', async () => {
    const res = await POST(makeReq({ title: 'T', doc_type: 'PRODUCT_SPEC', version: '1.0' }))
    expect(res.status).toBe(400)
  })
  it('正常 → 201', async () => {
    const c = makeChain()
    c.single.mockResolvedValue({ data: { id: 'd1' }, error: null })
    ;(supabaseAdmin.from as any).mockReturnValue(c)
    const res = await POST(makeReq({ title: 'API 文档', doc_type: 'API_DOC' }))
    expect(res.status).toBe(201)
  })
})

describe('GET /api/tech-documents', () => {
  it('未登录 → 401', async () => {
    const err = new Error('Unauthorized')
    err.name = 'AuthError'
    ;(requireAuth as any).mockRejectedValue(err)
    const res = await GET(makeGetReq('http://x/api/tech-documents'))
    expect(res.status).toBe(401)
  })
  it('按 doc_type 过滤', async () => {
    const c = makeChain()
    ;(supabaseAdmin.from as any).mockReturnValue(c)
    const res = await GET(makeGetReq('http://x/api/tech-documents?doc_type=API_DOC'))
    expect(res.status).toBe(200)
    expect(c.eq).toHaveBeenCalledWith('doc_type', 'API_DOC')
  })
})
