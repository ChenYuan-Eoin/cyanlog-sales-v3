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
import { getKnowledgeAccessContext } from '@/lib/knowledge/access'
import { PATCH } from './route'

function makeMalformedJsonRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'PATCH',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('PATCH /api/knowledge/pages/[id] validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    ;(getKnowledgeAccessContext as any).mockResolvedValue({ orgId: 'org-1', assignments: [] })
  })

  it('无效 JSON 返回参数错误且不访问数据库', async () => {
    const res = await PATCH(makeMalformedJsonRequest(), {
      params: Promise.resolve({ id: 'page-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
