/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  getAccessibleContract: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
import { getAccessibleContract } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

function makeMalformedRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeJsonRequest(body: unknown): any {
  return {
    json: async () => body,
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('POST /api/asks/[askId]/responses validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1', email: 'user@example.com' })
  })

  it('无效 JSON 复用 ASK 回应 schema，且不访问合同和数据库', async () => {
    const res = await POST(makeMalformedRequest(), {
      params: Promise.resolve({ askId: 'ask-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('V001')
    expect(body.error.message).toBe('回应内容格式不正确')
    expect(getAccessibleContract).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('字段类型错误复用 ASK 回应 schema，且不访问合同和数据库', async () => {
    const res = await POST(makeJsonRequest({ response_text: 123 }), {
      params: Promise.resolve({ askId: 'ask-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.success).toBe(false)
    expect(body.error.code).toBe('V001')
    expect(body.error.message).toBe('回应内容格式不正确')
    expect(getAccessibleContract).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
