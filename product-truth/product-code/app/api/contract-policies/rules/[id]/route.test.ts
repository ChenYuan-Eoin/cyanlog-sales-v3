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

import { PATCH } from './route'

function makeRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest
}

function makeParams(id = 'rule-1') {
  return { params: Promise.resolve({ id }) }
}

function oldRule() {
  return {
    id: 'rule-1',
    org_id: 'org-1',
    code: 'R001',
    name: '付款节奏',
    version: 1,
    business_domain: 'contract_review',
    risk_level: 'yellow',
    applicable_scenarios: ['standard_contract_review'],
    scope: 'org',
    category: 'ratio',
    engine_type: 'hybrid',
    target_field: 'payment_ratio',
    clause_category: 'payment',
    field_hints: ['首付款'],
    semantic_prompt: '识别付款比例。',
    message_template: {},
  }
}

describe('PATCH /api/contract-policies/rules/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('更新规则时保留规则集归属和结构化例外/输出模板', async () => {
    const snapshotInsert = vi.fn().mockResolvedValue({ data: null, error: null })
    const selectChain = {
      eq: vi.fn(() => selectChain),
      single: vi.fn().mockResolvedValue({ data: oldRule(), error: null }),
    }
    const update = vi.fn((payload) => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({
              data: { ...oldRule(), ...payload },
              error: null,
            }),
          })),
        })),
      })),
    }))

    mocks.from.mockImplementation((table: string) => {
      if (table === 'contract_rules_v2') {
        return {
          select: vi.fn(() => selectChain),
          update,
        }
      }
      if (table === 'contract_rule_snapshots') return { insert: snapshotInsert }
      return {}
    })

    const res = await PATCH(makeRequest({
      rule_set_id: '00000000-0000-4000-8000-000000000002',
      message_template: {
        title: '付款比例风险',
        levels: {
          exception: '项目已特批。',
        },
        outputs: {
          comment: '客户侧批注建议。',
        },
      },
    }), makeParams())

    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      rule_set_id: '00000000-0000-4000-8000-000000000002',
      message_template: expect.objectContaining({
        levels: { exception: '项目已特批。' },
        outputs: { comment: '客户侧批注建议。' },
      }),
      version: 2,
    }))
    expect(snapshotInsert).toHaveBeenCalledWith(expect.objectContaining({
      rule_id: 'rule-1',
      status: 'draft',
      config_snapshot: expect.objectContaining({
        message_template: expect.objectContaining({
          outputs: { comment: '客户侧批注建议。' },
        }),
      }),
    }))
  })
})
