import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), configAccess: vi.fn() }))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: async (_req: unknown, handler: (user: { id: string }, orgId: string) => Promise<Response>) => (
    handler({ id: 'user-1' }, 'org-1')
  ),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock('@/lib/configs/access', () => ({
  userHasFreshOrgConfigAccess: mocks.configAccess,
}))

import { DELETE, GET, PATCH } from './route'
import { RULE_WITH_PROBLEM_CATEGORY_SELECT } from '../rule-contract'

const problemCategoryId = '11111111-1111-4111-8111-111111111111'
const ruleSetId = '22222222-2222-4222-8222-222222222222'

function request(body: unknown) {
  return { json: async () => body } as unknown as NextRequest
}

const params = { params: Promise.resolve({ id: 'rule-1' }) }

function contract(threshold = 50_000) {
  return {
    schema_version: '1.0',
    properties: [{
      key: 'contract_amount',
      label: '合同金额',
      type: 'money',
      required: true,
      currency: 'CNY',
    }],
    decisions: [
      {
        id: 'pass',
        label: '通过',
        outcome: 'pass',
        priority: 10,
        match: 'all',
        conditions: [{ property_key: 'contract_amount', operator: '>=', value: threshold, unit: 'CNY' }],
      },
      {
        id: 'block',
        label: '红线',
        outcome: 'block',
        priority: 30,
        match: 'all',
        conditions: [{ property_key: 'contract_amount', operator: '<', value: threshold, unit: 'CNY' }],
      },
    ],
    missing_evidence_outcome: 'manual_review',
  }
}

describe('/api/contract-policies/rules/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.configAccess.mockResolvedValue(true)
  })

  it('denies rule detail reads without fresh config:read', async () => {
    mocks.configAccess.mockResolvedValue(false)

    const response = await GET(request(undefined), params)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toContain('config:read')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('returns the category relation and canonical contract for one rule', async () => {
    const row = {
      id: 'rule-1',
      problem_category_id: problemCategoryId,
      problem_category: { id: problemCategoryId, code: 'payment', name: '付款与结算' },
      rule_contract: null,
    }
    const chain = {
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({ data: row, error: null }),
    }
    chain.eq.mockReturnValue(chain)
    const select = vi.fn(() => chain)
    mocks.from.mockReturnValue({ select })

    const response = await GET(request(undefined), params)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.problem_category.code).toBe('payment')
    expect(body.data.rule_contract).toBeNull()
    expect(select).toHaveBeenCalledWith(RULE_WITH_PROBLEM_CATEGORY_SELECT)
  })

  it('rejects prompt/model/target field controls', async () => {
    const response = await PATCH(request({ target_field: 'contract_amount' }), params)
    expect(response.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('denies rule edits without fresh config:write', async () => {
    mocks.configAccess.mockResolvedValue(false)

    const response = await PATCH(request({}), params)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toContain('config:write')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('denies rule deletion without fresh config:write', async () => {
    mocks.configAccess.mockResolvedValue(false)

    const response = await DELETE(request(undefined), params)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toContain('config:write')
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('saves the canonical contract through the draft RPC and rereads its category relation', async () => {
    const oldRule = {
      id: 'rule-1',
      org_id: 'org-1',
      version: 2,
      name: '既有规则名称',
      description: '调用方未提交时必须保留',
      priority: 240,
      rule_set_id: ruleSetId,
      problem_category_id: problemCategoryId,
      rule_contract: contract(30_000),
    }
    const oldChain = {
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({ data: oldRule, error: null }),
    }
    oldChain.eq.mockReturnValue(oldChain)

    const categoryChain = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: { id: problemCategoryId, code: 'payment' },
        error: null,
      }),
    }
    categoryChain.select.mockReturnValue(categoryChain)
    categoryChain.eq.mockReturnValue(categoryChain)

    const ruleSetChain = {
      select: vi.fn(),
      eq: vi.fn(),
      single: vi.fn().mockResolvedValue({ data: { id: ruleSetId }, error: null }),
    }
    ruleSetChain.select.mockReturnValue(ruleSetChain)
    ruleSetChain.eq.mockReturnValue(ruleSetChain)
    const readChain = {
      eq: vi.fn(),
      select: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: {
          ...oldRule,
          version: 3,
          rule_contract: contract(),
          problem_category: { id: problemCategoryId, code: 'payment', name: '付款与结算' },
        },
        error: null,
      }),
    }
    readChain.eq.mockReturnValue(readChain)
    readChain.select.mockReturnValue(readChain)
    const selectRule = vi.fn((columns: string) => (
      columns === '*' ? oldChain : readChain
    ))
    mocks.rpc.mockResolvedValue({ data: { id: 'rule-1', version: 3 }, error: null })

    mocks.from.mockImplementation((table: string) => {
      if (table === 'contract_rules_v2') {
        return { select: selectRule }
      }
      if (table === 'contract_rule_problem_categories') return categoryChain
      if (table === 'contract_rule_sets') return ruleSetChain
      return {}
    })

    const response = await PATCH(request({
      rule_set_id: ruleSetId,
      problem_category_id: problemCategoryId,
      rule_contract: contract(),
    }), params)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.version).toBe(3)
    expect(mocks.rpc).toHaveBeenCalledWith('save_contract_rule_draft_v1', {
      p_org_id: 'org-1',
      p_user_id: 'user-1',
      p_rule_id: 'rule-1',
      p_payload: expect.objectContaining({
        rule_set_id: ruleSetId,
        problem_category_id: problemCategoryId,
        rule_contract: contract(),
        name: '既有规则名称',
        description: '调用方未提交时必须保留',
        priority: 240,
        version: 2,
        category: 'amount',
        target_field: 'contract_amount',
        clause_category: 'payment',
      }),
    })
    expect(selectRule).toHaveBeenCalledWith(RULE_WITH_PROBLEM_CATEGORY_SELECT)
  })

  it('returns 409 when another tab saved the locked rule version first', async () => {
    const oldRule = {
      id: 'rule-1',
      org_id: 'org-1',
      version: 2,
      name: '既有规则名称',
      rule_set_id: ruleSetId,
      problem_category_id: problemCategoryId,
      rule_contract: contract(30_000),
    }
    const query = (data: unknown) => {
      const chain = {
        select: vi.fn(),
        eq: vi.fn(),
        single: vi.fn().mockResolvedValue({ data, error: null }),
      }
      chain.select.mockReturnValue(chain)
      chain.eq.mockReturnValue(chain)
      return chain
    }
    const oldRuleQuery = query(oldRule)
    const categoryQuery = query({ id: problemCategoryId, code: 'payment' })
    const ruleSetQuery = query({ id: ruleSetId })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'contract_rules_v2') return oldRuleQuery
      if (table === 'contract_rule_problem_categories') return categoryQuery
      if (table === 'contract_rule_sets') return ruleSetQuery
      return {}
    })
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'RULE_DRAFT_VERSION_CONFLICT' },
    })

    const response = await PATCH(request({
      rule_set_id: ruleSetId,
      problem_category_id: problemCategoryId,
      rule_contract: contract(),
    }), params)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.message).toContain('其他页面更新')
    expect(mocks.rpc).toHaveBeenCalledWith('save_contract_rule_draft_v1', expect.objectContaining({
      p_payload: expect.objectContaining({ version: 2 }),
    }))
  })
})
