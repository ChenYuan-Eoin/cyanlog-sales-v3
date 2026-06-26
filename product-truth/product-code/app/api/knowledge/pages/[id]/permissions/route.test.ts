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

vi.mock('@/lib/knowledge/access', () => ({
  canUseKnowledgePage: vi.fn(),
  fetchKnowledgePermissions: vi.fn(),
  getKnowledgeAccessContext: vi.fn(),
}))

import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { DELETE, POST } from './route'

function makeMalformedJsonRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeJsonRequest(body: unknown, method = 'POST'): any {
  return {
    json: async () => body,
    method,
    headers: new Headers({ 'content-type': 'application/json' }),
    nextUrl: new URL('http://localhost/api/knowledge/pages/page-1/permissions'),
  }
}

describe('POST /api/knowledge/pages/[id]/permissions validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
  })

  it('无效 JSON 返回参数错误且不访问数据库', async () => {
    const res = await POST(makeMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'page-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('字段类型错误返回参数错误且不访问数据库', async () => {
    const res = await POST(makeJsonRequest({
      principal_type: 'user',
      principal_id: 123,
      permission: 'view',
    }), {
      params: Promise.resolve({ id: 'page-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/knowledge/pages/[id]/permissions validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
  })

  it('权限 ID 类型错误返回必填错误且不访问数据库', async () => {
    const res = await DELETE(makeJsonRequest({ permId: 123 }, 'DELETE'), {
      params: Promise.resolve({ id: 'page-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('权限ID必填')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
