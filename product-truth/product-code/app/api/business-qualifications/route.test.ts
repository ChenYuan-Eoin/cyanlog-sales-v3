// 测试 app/api/business-qualifications/route.ts
// F017 商务资质库

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

function makeChain() {
  const c: any = {}
  ;['select', 'eq', 'order', 'insert'].forEach((m) => {
    c[m] = vi.fn().mockReturnValue(c)
  })
  c.single = vi.fn()
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
function makeGetReq(url: string): any {
  return { url, method: 'GET', headers: new Headers() }
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
})

describe('POST /api/business-qualifications', () => {
  it('缺 title → 400', async () => {
    const res = await POST(makeReq({ qual_type: 'ENTERPRISE' }))
    expect(res.status).toBe(400)
  })
  it('无效 qual_type → 400', async () => {
    const res = await POST(makeReq({ title: 'T', qual_type: 'BAD' }))
    expect(res.status).toBe(400)
  })
  it('无效日期 → 400', async () => {
    const res = await POST(
      makeReq({ title: 'T', qual_type: 'ENTERPRISE', expires_at: 'invalid' })
    )
    expect(res.status).toBe(400)
  })
  it('正常 → 201', async () => {
    const c = makeChain()
    c.single.mockResolvedValue({ data: { id: 'q1' }, error: null })
    ;(supabaseAdmin.from as any).mockReturnValue(c)
    const res = await POST(
      makeReq({ title: '营业执照', qual_type: 'ENTERPRISE', expires_at: '2027-01-01' })
    )
    expect(res.status).toBe(201)
  })
})

describe('GET /api/business-qualifications', () => {
  it('未登录 → 401', async () => {
    const err = new Error('Unauthorized')
    err.name = 'AuthError'
    ;(requireAuth as any).mockRejectedValue(err)
    const res = await GET(makeGetReq('http://x/api/business-qualifications'))
    expect(res.status).toBe(401)
  })
  it('按 qual_type 过滤', async () => {
    const c = makeChain()
    ;(supabaseAdmin.from as any).mockReturnValue(c)
    const res = await GET(makeGetReq('http://x/api/business-qualifications?qual_type=PERSONNEL'))
    expect(res.status).toBe(200)
    expect(c.eq).toHaveBeenCalledWith('qual_type', 'PERSONNEL')
  })
})
