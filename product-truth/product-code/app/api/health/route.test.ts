// 测试 app/api/health/route.ts
// 覆盖：DB 正常/异常、环境变量缺失、HTTP 状态码

/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock supabase
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { GET } from './route'

// 构造 NextRequest（保留以备未来场景使用，当前测试无需构造）

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('DB 正常 + 环境齐全 → 200 ok', async () => {
    ;(supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'u1' }, error: null }),
    })
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
    expect(body.checks).toHaveLength(2)
    expect(body.checks.find((c: any) => c.name === 'database').status).toBe('ok')
    expect(body.checks.find((c: any) => c.name === 'environment').status).toBe('ok')
    expect(body.timestamp).toBeTruthy()
  })

  it('DB 异常 → 503 down', async () => {
    ;(supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST500', message: 'DB connection failed' },
      }),
    })
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.status).toBe('down')
    const dbCheck = body.checks.find((c: any) => c.name === 'database')
    expect(dbCheck.status).toBe('down')
    expect(dbCheck.message).toContain('DB')
  })

  it('DB 空表（PGRST116）视为正常', async () => {
    ;(supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: null,
        error: { code: 'PGRST116', message: 'no rows' },
      }),
    })
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.status).toBe('ok')
  })

  it('环境变量缺失 → 503 down', async () => {
    // Mock DB 正常但 env 缺失
    ;(supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'u1' }, error: null }),
    })
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    delete process.env.NEXT_PUBLIC_SUPABASE_URL

    const res = await GET()
    const body = await res.json()

    expect(res.status).toBe(503)
    expect(body.status).toBe('down')
    const envCheck = body.checks.find((c: any) => c.name === 'environment')
    expect(envCheck.status).toBe('down')
    expect(envCheck.message).toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('只缺 NEXT_PUBLIC_SUPABASE_URL 时报告 URL 缺失', async () => {
    ;(supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'u1' }, error: null }),
    })
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'
    delete process.env.NEXT_PUBLIC_SUPABASE_URL

    const res = await GET()
    const body = await res.json()
    const envCheck = body.checks.find((c: any) => c.name === 'environment')
    expect(envCheck.message).toContain('NEXT_PUBLIC_SUPABASE_URL')
  })

  it('响应包含 uptime 和 version', async () => {
    ;(supabaseAdmin.from as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: { id: 'u1' }, error: null }),
    })
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key'

    const res = await GET()
    const body = await res.json()
    expect(typeof body.uptime).toBe('number')
    expect(body.version).toBeTruthy()
    expect(typeof body.totalLatencyMs).toBe('number')
  })
})
