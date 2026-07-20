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
import { RULE_WITH_PROBLEM_CATEGORY_SELECT } from './rule-contract'

const problemCategoryId = '11111111-1111-4111-8111-111111111111'

function request(url: string, body?: unknown) {
  return {
    url,
    json: async () => body,
  } as unknown as NextRequest
}

function contract() {
  return {
    schema_version: '1.0',
    properties: [
      {
        key: 'initial_payment_ratio',
        label: '首付款比例',
        description: '合同签署后的首期付款占合同总额的比例。',
        type: 'percentage',
        required: true,
        unit: 'percent',
      },
      {
        key: 'final_payment_days',
        label: '尾款期限',
        type: 'duration',
        required: true,
        unit: 'day',
      },
    ],
    decisions: [
      {
        id: 'pass',
        label: '通过',
        outcome: 'pass',
        priority: 10,
        match: 'all',
        conditions: [
          { property_key: 'initial_payment_ratio', operator: '>=', value: 30, unit: 'percent' },
          { property_key: 'final_payment_days', operator: '<=', value: 30, unit: 'day' },
        ],
      },
      {
        id: 'block',
        label: '红线',
        outcome: 'block',
        priority: 30,
        match: 'any',
        conditions: [
          { property_key: 'initial_payment_ratio', operator: '<', value: 15, unit: 'percent' },
          { property_key: 'final_payment_days', operator: '>', value: 90, unit: 'day' },
        ],
        message: '首付款或尾款期限触发红线',
      },
    ],
    missing_evidence_outcome: 'manual_review',
  }
}

describe('/api/contract-policies/rules', () => {
  beforeEach(() => vi.clearAllMocks())

  it('loads rules with their business problem category relation', async () => {
    const rules = [{
      id: 'rule-1',
      problem_category_id: problemCategoryId,
      problem_category: { id: problemCategoryId, code: 'payment', name: '付款与结算' },
      rule_contract: contract(),
    }]
    const chain: Record<string, unknown> = { data: rules, error: null }
    chain.select = vi.fn(() => chain)
    chain.eq = vi.fn(() => chain)
    chain.order = vi.fn(() => chain)
    mocks.from.mockReturnValue(chain)

    const response = await GET(request('http://localhost/api/contract-policies/rules'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data[0].problem_category.code).toBe('payment')
    expect(chain.select).toHaveBeenCalledWith(RULE_WITH_PROBLEM_CATEGORY_SELECT)
  })

  it('rejects legacy prompt/model/engine fields before any database write', async () => {
    const response = await POST(request('http://localhost/api/contract-policies/rules', {
      code: 'R100',
      name: '付款节奏',
      problem_category_id: problemCategoryId,
      rule_contract: contract(),
      semantic_prompt: '识别付款条款',
      model_id: 'gpt-5.5',
      engine_type: 'hybrid',
    }))

    expect(response.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('persists canonical rule details and derives legacy columns only as an adapter', async () => {
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

    const insert = vi.fn()
    const ruleChain = {
      select: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'rule-1',
          version: 1,
          problem_category_id: problemCategoryId,
          problem_category: { id: problemCategoryId, code: 'payment', name: '付款与结算' },
          rule_contract: contract(),
        },
        error: null,
      }),
    }
    ruleChain.select.mockReturnValue(ruleChain)
    insert.mockReturnValue(ruleChain)
    const snapshotInsert = vi.fn().mockResolvedValue({ data: null, error: null })

    mocks.from.mockImplementation((table: string) => {
      if (table === 'contract_rule_problem_categories') return categoryChain
      if (table === 'contract_rules_v2') return { insert }
      if (table === 'contract_rule_snapshots') return { insert: snapshotInsert }
      return {}
    })

    const response = await POST(request('http://localhost/api/contract-policies/rules', {
      code: 'R100',
      name: '付款节奏',
      problem_category_id: problemCategoryId,
      rule_contract: contract(),
    }))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.data.problem_category.code).toBe('payment')
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      problem_category_id: problemCategoryId,
      rule_contract: contract(),
      category: 'ratio',
      target_field: 'initial_payment_ratio',
      clause_category: 'payment',
      engine_type: 'structured',
      semantic_prompt: null,
      lifecycle_status: 'ready_to_publish',
      translation_status: 'ready',
    }))
    expect(snapshotInsert).toHaveBeenCalledWith(expect.objectContaining({
      rule_id: 'rule-1',
      status: 'draft',
    }))
  })
})
