// 测试 app/api/tenders/ocr/route.ts
// 覆盖：认证、文件缺失、解析成功

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

vi.mock('@/lib/ocr/parser', () => ({
  parseDocument: vi.fn().mockResolvedValue('招标编号：ZB-001\n项目名称：测试项目'),
  extractKeyInfo: vi.fn().mockReturnValue({
    tenderNo: 'ZB-001',
    tenderName: '测试项目',
    budget: '100万',
    deadline: '2024-12-31',
    publisher: '测试采购人',
    contact: '13800138000',
    confidence: 95,
    scores: [{ item: '技术方案', weight: 30, maxScore: 30 }],
    technicalRequirements: ['系统支持 10000 并发'],
    commercialTerms: ['付款方式：30/70'],
    timeline: [{ event: '报名', date: '2024-01-15' }],
  }),
}))

import { requireAuth } from '@/lib/auth'
import { POST } from './route'

function makeFormRequest(file: File | null): any {
  const formData = {
    get: (name: string) => (name === 'file' ? file : null),
  }
  return {
    formData: async () => formData,
    method: 'POST',
    headers: new Headers(),
  }
}

function makeFile(name: string, content = 'fake content', type = 'text/plain'): File {
  return new File([content], name, { type })
}

describe('POST /api/tenders/ocr', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('未登录 → 401 UNAUTHORIZED', async () => {
    const authErr = new Error('Unauthorized')
    authErr.name = 'AuthError'
    ;(requireAuth as any).mockRejectedValue(authErr)
    const res = await POST(makeFormRequest(makeFile('a.txt')))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.code).toBe('UNAUTHORIZED')
  })

  it('未提供文件 → 400 MISSING_FILE', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const res = await POST(makeFormRequest(null))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.code).toBe('MISSING_FILE')
  })

  it('提供文件 → 200 含结构化信息', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    ;(supabaseAdmin.from as any).mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'ocr-1', confidence: 95 },
        error: null,
      }),
    })

    const res = await POST(makeFormRequest(makeFile('tender.txt')))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data.id).toBe('ocr-1')
    expect(body.data.keyInfo.tenderNo).toBe('ZB-001')
    expect(body.data.keyInfo.scores).toHaveLength(1)
    expect(body.data.confidence).toBe(95)
  })

  it('DB 插入失败 → 500 DB_ERROR', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
    const { supabaseAdmin } = await import('@/lib/supabase')
    ;(supabaseAdmin.from as any).mockReturnValue({
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'DB connection failed' },
      }),
    })

    const res = await POST(makeFormRequest(makeFile('a.txt')))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.code).toBe('DB_ERROR')
  })
})
