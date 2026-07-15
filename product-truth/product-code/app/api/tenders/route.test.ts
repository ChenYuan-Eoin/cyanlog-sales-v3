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

function makeRequest(): any {
  return new Request('https://example.test/api/tenders')
}

function makeQuery(result: any) {
  const chain: any = {}
  chain.select = vi.fn().mockReturnValue(chain)
  chain.eq = vi.fn().mockReturnValue(chain)
  chain.order = vi.fn().mockReturnValue(chain)
  chain.limit = vi.fn().mockResolvedValue(result)
  return chain
}

describe('GET /api/tenders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'u-1' })
  })

  it('未登录 -> 401', async () => {
    const authError = new Error('unauthorized')
    authError.name = 'AuthError'
    ;(requireAuth as any).mockRejectedValue(authError)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.code).toBe('UNAUTHORIZED')
  })

  it('只返回当前用户最近 50 条 OCR 标书记录', async () => {
    const query = makeQuery({
      data: [{ id: 'ocr-1', original_file: 'demo.pdf', status: 'completed' }],
      error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValue(query)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(1)
    expect(supabaseAdmin.from).toHaveBeenCalledWith('ocr_results')
    expect(query.select).toHaveBeenCalledWith('id, original_file, key_info, confidence, status, created_at')
    expect(query.eq).toHaveBeenCalledWith('created_by', 'u-1')
    expect(query.order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(query.limit).toHaveBeenCalledWith(50)
  })

  it('不会用其他用户或无所有者记录扩大列表范围', async () => {
    const query = makeQuery({ data: [], error: null })
    ;(requireAuth as any).mockResolvedValue({ id: 'u-2' })
    ;(supabaseAdmin.from as any).mockReturnValue(query)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual([])
    expect(query.eq).toHaveBeenCalledTimes(1)
    expect(query.eq).toHaveBeenCalledWith('created_by', 'u-2')
  })

  it('数据库错误 -> 500 DB_ERROR', async () => {
    const query = makeQuery({ data: null, error: { message: 'failed' } })
    ;(supabaseAdmin.from as any).mockReturnValue(query)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.code).toBe('DB_ERROR')
  })
})
