import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

import type { ContractRuleAsset } from '@/types/contract-rule-assets'

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_req, handler) => handler({ id: 'user-1' }, 'org-1')),
}))

vi.mock('@/lib/rules/rule-assets-server', () => ({
  loadRuleAsset: vi.fn(),
}))

vi.mock('@/lib/ai/failover', () => ({
  reviewWithFailoverSync: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { POST } from './route'
import { reviewWithFailoverSync } from '@/lib/ai/failover'
import { loadRuleAsset } from '@/lib/rules/rule-assets-server'
import { supabaseAdmin } from '@/lib/supabase'

const baseRule: ContractRuleAsset = {
  id: 'rule-1',
  org_id: 'org-1',
  rule_set_id: 'set-1',
  code: 'R001',
  name: '付款节奏',
  description: '检查首付款比例',
  category: 'ratio',
  applicable_scenarios: ['customer_contract'],
  scope: 'org',
  level_a_operator: '>=',
  level_a_threshold: 30,
  level_a_unit: 'percent',
  level_a_action: 'auto_accept',
  level_b_operator: '>=',
  level_b_threshold: 15,
  level_b_unit: 'percent',
  level_b_action: 'negotiate',
  level_b_counterparty: null,
  level_c_operator: '<',
  level_c_threshold: 15,
  level_c_unit: 'percent',
  level_c_action: 'block',
  level_c_message: null,
  approval_roles: [],
  version: 1,
  priority: 100,
  is_active: true,
  engine_type: 'structured',
  target_field: 'advance_ratio',
  clause_category: 'payment',
  field_hints: ['首付'],
  semantic_prompt: null,
  message_template: {},
  business_domain: 'payment',
  risk_level: 'yellow',
  lifecycle_status: 'ready_to_publish',
  translation_status: 'ready',
  translation_notes: [],
  translation_diff: [],
  translated_at: null,
  published_at: null,
  created_at: '2026-07-13T00:00:00Z',
  updated_at: '2026-07-13T00:00:00Z',
}

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/contract-policies/rules/rule-1/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeInsertChain(id = 'eval-1') {
  return {
    insert: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id }, error: null }),
  }
}

describe('POST /api/contract-policies/rules/[id]/test', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(loadRuleAsset).mockResolvedValue(baseRule)
    vi.mocked(supabaseAdmin.from).mockReturnValue(makeInsertChain() as never)
  })

  it('requires an explicit expected result before recording release evidence', async () => {
    const response = await POST(makeRequest({ fields: { advance_ratio: 20 } }), {
      params: Promise.resolve({ id: 'rule-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toContain('预期命中')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('persists deterministic evaluation evidence', async () => {
    const chain = makeInsertChain('eval-deterministic')
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as never)

    const response = await POST(makeRequest({
      fields: { advance_ratio: 20 },
      expected_triggered: true,
    }), { params: Promise.resolve({ id: 'rule-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      status: 'matched',
      mode: 'deterministic',
      evidence: {
        evaluation_status: 'passed',
        evaluation_run_id: 'eval-deterministic',
        provider: null,
      },
    })
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({
      rule_id: 'rule-1',
      mode: 'deterministic',
      status: 'passed',
      expected_snapshot: { triggered: true },
    }))
  })

  it('uses a real model and records provider and token evidence for semantic rules', async () => {
    vi.mocked(loadRuleAsset).mockResolvedValue({
      ...baseRule,
      category: 'text',
      engine_type: 'semantic',
      target_field: null,
      semantic_prompt: '识别无限责任条款',
    })
    vi.mocked(reviewWithFailoverSync).mockResolvedValue({
      provider: 'sales_cloud_backup',
      model: 'gpt-5.5',
      degraded: false,
      summary: '测试文本命中无限责任风险',
      risks: [{ level: 'red', title: ' match ', description: '无限责任', suggestion: '' }],
      usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
    } as never)
    const chain = makeInsertChain('eval-model')
    vi.mocked(supabaseAdmin.from).mockReturnValue(chain as never)

    const response = await POST(makeRequest({
      text: '乙方承担全部且无限责任。',
      expected_triggered: true,
      preferred_provider: 'sales_cloud_backup',
    }), { params: Promise.resolve({ id: 'rule-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(reviewWithFailoverSync).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      preferredProvider: 'sales_cloud_backup',
      phase: 'contract_rule_release_eval',
    }), 0)
    expect(vi.mocked(reviewWithFailoverSync).mock.calls[0]?.[0]).toContain(
      '"source_quote":null,"rule_code":null,"rule_snapshot_id":null'
    )
    expect(body.data.evidence).toMatchObject({
      evaluation_status: 'passed',
      evaluation_run_id: 'eval-model',
      provider: 'sales_cloud_backup',
      degraded: false,
      usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
    })
    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({
      mode: 'model',
      status: 'passed',
      provider: 'sales_cloud_backup',
      degraded: false,
    }))
  })

  it('records degraded model output as an error and never as passing evidence', async () => {
    vi.mocked(loadRuleAsset).mockResolvedValue({
      ...baseRule,
      category: 'text',
      engine_type: 'semantic',
      target_field: null,
      semantic_prompt: '识别无限责任条款',
    })
    vi.mocked(reviewWithFailoverSync).mockResolvedValue({
      provider: 'rule_engine',
      model: 'rule-engine',
      degraded: true,
      summary: '规则兜底命中',
      risks: [{ level: 'red', title: 'MATCH', description: '兜底结果', suggestion: '' }],
      usage: undefined,
    } as never)

    const response = await POST(makeRequest({
      text: '乙方承担全部且无限责任。',
      expected_triggered: true,
    }), { params: Promise.resolve({ id: 'rule-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.evidence).toMatchObject({
      evaluation_status: 'error',
      provider: 'rule_engine',
      degraded: true,
    })
  })
})
