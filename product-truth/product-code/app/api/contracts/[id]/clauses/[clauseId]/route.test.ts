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
import { PATCH } from './route'

function makeMalformedRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'PATCH',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeJsonRequest(body: unknown): any {
  return {
    json: async () => body,
    method: 'PATCH',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('PATCH /api/contracts/[id]/clauses/[clauseId] validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
  })

  it('无效 JSON 返回格式错误且不查询合同和条款', async () => {
    const res = await PATCH(makeMalformedRequest(), {
      params: Promise.resolve({ id: 'contract-1', clauseId: 'clause-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_JSON')
    expect(getAccessibleContract).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('字段类型错误返回状态错误且不查询合同和条款', async () => {
    const res = await PATCH(makeJsonRequest({ review_status: 123 }), {
      params: Promise.resolve({ id: 'contract-1', clauseId: 'clause-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_STATUS')
    expect(getAccessibleContract).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('非法状态值返回状态错误且不查询合同和条款', async () => {
    const res = await PATCH(makeJsonRequest({ review_status: 'done' }), {
      params: Promise.resolve({ id: 'contract-1', clauseId: 'clause-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_STATUS')
    expect(getAccessibleContract).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })
})
