import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: async (_req: unknown, handler: (user: { id: string }, orgId: string) => Promise<Response>) => (
    handler({ id: 'u1' }, 'org-1')
  ),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: mocks.from,
  },
}))

import { POST } from './route'

function makeRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest
}

function validRulePayload() {
  return {
    code: 'R999',
    name: '测试规则',
    rule_set_id: '00000000-0000-4000-8000-000000000001',
    business_domain: 'contract_review',
    risk_level: 'yellow',
    category: 'ratio',
    engine_type: 'hybrid',
    target_field: 'payment_ratio',
    clause_category: 'payment',
    field_hints: ['首付款', '付款比例'],
    semantic_prompt: '识别首付款比例是否超过标准。',
    message_template: {
      title: '付款比例风险',
      suggestion: '请将付款比例调整至双方可接受范围。',
      levels: {
        exception: '已取得特批签报。',
      },
      outputs: {
        comment: '客户侧批注建议。',
      },
    },
    applicable_scenarios: ['standard_contract_review'],
    scope: 'org',
    level_a_operator: '<=',
    level_a_threshold: 30,
    level_a_unit: 'percent',
    level_a_action: 'auto_approve',
    level_b_operator: '>',
    level_b_threshold: 30,
    level_b_unit: 'percent',
    level_b_action: 'suggest_counterparty',
    level_c_operator: '>',
    level_c_threshold: 50,
    level_c_unit: 'percent',
    level_c_action: 'block',
    priority: 100,
    is_active: true,
  }
}

describe('POST /api/contract-policies/rules', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('保留规则集归属和结构化例外/输出模板', async () => {
    const snapshotInsert = vi.fn().mockResolvedValue({ data: null, error: null })
    const insert = vi.fn((payload) => ({
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({
          data: { id: 'rule-1', ...payload },
          error: null,
        }),
      })),
    }))

    mocks.from.mockImplementation((table: string) => {
      if (table === 'contract_rules_v2') return { insert }
      if (table === 'contract_rule_snapshots') return { insert: snapshotInsert }
      return {}
    })

    const res = await POST(makeRequest(validRulePayload()))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.data.id).toBe('rule-1')
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      rule_set_id: '00000000-0000-4000-8000-000000000001',
      message_template: expect.objectContaining({
        levels: { exception: '已取得特批签报。' },
        outputs: { comment: '客户侧批注建议。' },
      }),
    }))
    expect(snapshotInsert).toHaveBeenCalledWith(expect.objectContaining({
      rule_id: 'rule-1',
      status: 'draft',
      config_snapshot: expect.objectContaining({
        message_template: expect.objectContaining({
          levels: { exception: '已取得特批签报。' },
        }),
      }),
    }))
  })
})
