import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: async (_req: unknown, handler: (user: { id: string }, orgId: string) => Promise<Response>) => (
    handler({ id: 'user-1' }, 'org-1')
  ),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

import { GET, POST } from './route'

function request(url: string, body?: unknown) {
  return {
    url,
    json: async () => body,
  } as unknown as NextRequest
}

describe('/api/contract-policies/rule-categories', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the stable business categories in data[]', async () => {
    const categories = [{ id: 'category-1', code: 'payment', name: '付款与结算' }]
    const chain: Record<string, unknown> = { data: categories, error: null }
    chain.select = vi.fn(() => chain)
    chain.eq = vi.fn(() => chain)
    chain.order = vi.fn(() => chain)
    mocks.from.mockReturnValue(chain)

    const response = await GET(request('http://localhost/api/contract-policies/rule-categories'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({ success: true, data: categories })
    expect(mocks.from).toHaveBeenCalledWith('contract_rule_problem_categories')
  })

  it('does not allow a property type to masquerade as a business category', async () => {
    const response = await POST(request('http://localhost/api/contract-policies/rule-categories', {
      code: 'amount',
      name: '金额类',
    }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toContain('不能作为问题分类')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('persists a new organization category through the server control plane', async () => {
    const inserted = {
      id: 'category-2',
      org_id: 'org-1',
      code: 'performance_guarantee',
      name: '履约担保',
      sort_order: 140,
      is_active: true,
    }
    const insert = vi.fn()
    const chain = {
      select: vi.fn(),
      single: vi.fn().mockResolvedValue({ data: inserted, error: null }),
    }
    chain.select.mockReturnValue(chain)
    insert.mockReturnValue(chain)
    mocks.from.mockReturnValue({ insert })

    const response = await POST(request('http://localhost/api/contract-policies/rule-categories', {
      code: 'performance_guarantee',
      name: '履约担保',
      sort_order: 140,
    }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.data).toEqual(inserted)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      org_id: 'org-1',
      created_by: 'user-1',
      code: 'performance_guarantee',
    }))
  })
})
