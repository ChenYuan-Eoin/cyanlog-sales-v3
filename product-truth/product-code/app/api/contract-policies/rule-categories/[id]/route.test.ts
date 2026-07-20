import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  configAccess: vi.fn(),
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: async (_req: unknown, handler: (user: { id: string }, orgId: string) => Promise<Response>) => (
    handler({ id: 'user-1' }, 'org-1')
  ),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from, rpc: mocks.rpc },
}))

vi.mock('@/lib/configs/access', () => ({
  userHasFreshOrgConfigAccess: mocks.configAccess,
}))

import { DELETE, PATCH } from './route'

function request(body?: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

const params = { params: Promise.resolve({ id: 'category-1' }) }

describe('/api/contract-policies/rule-categories/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.configAccess.mockResolvedValue(true)
  })

  it('marks referenced RuleSets pending through the atomic category RPC', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        id: 'category-1',
        org_id: 'org-1',
        code: 'payment',
        name: '付款、结算与发票',
        description: '新版业务定义',
        is_active: true,
        referenced_rule_sets_pending: true,
      },
      error: null,
    })

    const response = await PATCH(request({
      name: '付款、结算与发票',
      description: '新版业务定义',
    }), params)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.referenced_rule_sets_pending).toBe(true)
    expect(mocks.rpc).toHaveBeenCalledWith('update_contract_rule_problem_category_v1', {
      p_org_id: 'org-1',
      p_user_id: 'user-1',
      p_category_id: 'category-1',
      p_payload: {
        name: '付款、结算与发票',
        description: '新版业务定义',
      },
    })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('returns 409 when PATCH tries to deactivate a category used by active rules', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'RULE_CATEGORY_ACTIVE_REFERENCES' },
    })

    const response = await PATCH(request({ is_active: false }), params)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.message).toContain('仍被启用规则引用')
  })

  it('returns 409 instead of creating dangling references when DELETE is requested', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'RULE_CATEGORY_ACTIVE_REFERENCES' },
    })

    const response = await DELETE(request(), params)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.message).toContain('先停用或迁移')
    expect(mocks.rpc).toHaveBeenCalledWith('update_contract_rule_problem_category_v1', {
      p_org_id: 'org-1',
      p_user_id: 'user-1',
      p_category_id: 'category-1',
      p_payload: { is_active: false },
    })
  })

  it('deactivates an unreferenced category without deleting its audit identity', async () => {
    mocks.rpc.mockResolvedValue({
      data: { id: 'category-1', is_active: false },
      error: null,
    })

    const response = await DELETE(request(), params)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual({ id: 'category-1' })
  })

  it('checks config:write before parsing or mutating', async () => {
    mocks.configAccess.mockResolvedValue(false)

    const response = await PATCH(request({ name: '不会写入' }), params)

    expect(response.status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
