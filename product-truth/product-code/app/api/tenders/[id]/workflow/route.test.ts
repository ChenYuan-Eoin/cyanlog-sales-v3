/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { PATCH, POST } from './route'

function makeJsonRequest(body: unknown, method: 'POST' | 'PATCH'): any {
  return {
    json: async () => body,
    method,
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('POST /api/tenders/[id]/workflow validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
  })

  it('非法方向返回参数错误且不访问数据库', async () => {
    const res = await POST(makeJsonRequest({ direction: 'sideways' }, 'POST'), {
      params: Promise.resolve({ id: 'tender-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.error).toBe('工作流方向无效')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/tenders/[id]/workflow validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
  })

  it('步骤数据类型错误返回参数错误且不访问数据库', async () => {
    const res = await PATCH(makeJsonRequest({ checkpoint_data: 'done' }, 'PATCH'), {
      params: Promise.resolve({ id: 'tender-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.error).toBe('步骤数据无效')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
