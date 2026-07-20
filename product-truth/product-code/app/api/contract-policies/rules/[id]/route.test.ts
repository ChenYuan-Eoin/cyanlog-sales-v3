import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: async (_req: unknown, handler: (user: { id: string }, orgId: string) => Promise<Response>) => (
    handler({ id: 'user-1' }, 'org-1')
  ),
}))

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { GET, PATCH } from './route'
import { RULE_WITH_PROBLEM_CATEGORY_SELECT } from '../rule-contract'

const problemCategoryId = '11111111-1111-4111-8111-111111111111'

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
  beforeEach(() => vi.clearAllMocks())

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

  it('updates the canonical contract, related category and snapshot together', async () => {
    const oldRule = {
      id: 'rule-1',
      org_id: 'org-1',
      version: 2,
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

    const update = vi.fn()
    const updateChain = {
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
    updateChain.eq.mockReturnValue(updateChain)
    updateChain.select.mockReturnValue(updateChain)
    update.mockReturnValue(updateChain)
    const snapshotInsert = vi.fn().mockResolvedValue({ data: null, error: null })

    mocks.from.mockImplementation((table: string) => {
      if (table === 'contract_rules_v2') {
        return {
          select: vi.fn(() => oldChain),
          update,
        }
      }
      if (table === 'contract_rule_problem_categories') return categoryChain
      if (table === 'contract_rule_snapshots') return { insert: snapshotInsert }
      return {}
    })

    const response = await PATCH(request({
      problem_category_id: problemCategoryId,
      rule_contract: contract(),
    }), params)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.version).toBe(3)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      rule_contract: contract(),
      category: 'amount',
      target_field: 'contract_amount',
      clause_category: 'payment',
      version: 3,
      translation_status: 'ready',
    }))
    expect(snapshotInsert).toHaveBeenCalledWith(expect.objectContaining({
      rule_id: 'rule-1',
      version: 3,
      status: 'draft',
    }))
  })
})
