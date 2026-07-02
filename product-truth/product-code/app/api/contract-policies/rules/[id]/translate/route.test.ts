import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  generateTextWithFailover: vi.fn(),
  resolvePublishedModelPolicy: vi.fn(),
  recordModelInvocation: vi.fn(),
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

vi.mock('@/lib/ai/failover', () => ({
  generateTextWithFailover: mocks.generateTextWithFailover,
}))

vi.mock('@/lib/contracts/model-policy', () => ({
  resolvePublishedModelPolicy: mocks.resolvePublishedModelPolicy,
  recordModelInvocation: mocks.recordModelInvocation,
}))

import { POST } from './route'

function makeRequest(body: unknown) {
  return {
    json: async () => body,
  } as unknown as NextRequest
}

function makeParams(id = 'rule-1') {
  return { params: Promise.resolve({ id }) }
}

function baseRule() {
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
    engine_type: 'hybrid',
    target_field: null,
    clause_category: null,
    field_hints: [],
    semantic_prompt: null,
    message_template: {},
    translation_status: 'needs_ai_translation',
    lifecycle_status: 'needs_translation',
  }
}

function setupSupabase(rule = baseRule()) {
  const update = vi.fn()
  const snapshotInsert = vi.fn().mockResolvedValue({ data: null, error: null })
  const selectChain = {
    eq: vi.fn(() => selectChain),
    single: vi.fn().mockResolvedValue({ data: rule, error: null }),
  }
  const updateChain = {
    eq: vi.fn(() => updateChain),
    select: vi.fn(() => updateChain),
    single: vi.fn().mockResolvedValue({
      data: { ...rule, target_field: 'payment_schedule', version: 2, translation_status: 'ready' },
      error: null,
    }),
  }
  update.mockReturnValue(updateChain)

  mocks.from.mockImplementation((table: string) => {
    if (table === 'contract_rules_v2') {
      return {
        select: vi.fn(() => selectChain),
        update,
      }
    }
    if (table === 'contract_rule_snapshots') {
      return {
        insert: snapshotInsert,
      }
    }
    return {}
  })

  return { update, snapshotInsert }
}

describe('POST /api/contract-policies/rules/[id]/translate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePublishedModelPolicy.mockResolvedValue({ id: 'policy-1' })
    mocks.recordModelInvocation.mockResolvedValue({ id: 'invocation-1' })
    mocks.generateTextWithFailover.mockResolvedValue({
      text: JSON.stringify({
        target_field: 'payment_schedule',
        clause_category: 'payment',
        field_hints: ['首付款', '付款节奏'],
        semantic_prompt: '识别付款节奏是否偏离标准。',
        message_template: {
          title: '付款节奏风险',
          comment: '建议调整付款节奏。',
          negotiation_action: '销售需与客户确认付款节点。',
          negotiation_required: true,
        },
        notes: ['AI 草稿，需人工确认'],
      }),
      provider: 'AI_LEVEL_2',
      model: 'gpt-5.5',
      providerKind: 'openai_compatible',
      transport: 'openai_compatible_http',
      degraded: false,
      attemptErrors: [],
    })
  })

  it('默认只生成字段级转译草稿，不写回规则', async () => {
    const { update, snapshotInsert } = setupSupabase()

    const res = await POST(makeRequest({}), makeParams())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.applied).toBe(false)
    expect(body.data.diff).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: 'target_field', after: 'payment_schedule', changed: true }),
    ]))
    expect(body.data.model_invocation_id).toBe('invocation-1')
    expect(mocks.generateTextWithFailover).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ orgId: 'org-1', timeoutMs: 15000 }),
      1
    )
    expect(update).not.toHaveBeenCalled()
    expect(snapshotInsert).not.toHaveBeenCalled()
  })

  it('模型长时间不返回时按接口硬超时失败，不写回规则', async () => {
    vi.useFakeTimers()
    try {
      const { update } = setupSupabase()
      mocks.generateTextWithFailover.mockReturnValueOnce(new Promise(() => {}))

      const responsePromise = POST(makeRequest({}), makeParams())
      await vi.advanceTimersByTimeAsync(15_000)
      const res = await responsePromise
      const body = await res.json()

      expect(res.status).toBe(503)
      expect(body.error.message).toContain('规则转译超过 15 秒未返回')
      expect(update).not.toHaveBeenCalled()
      expect(mocks.recordModelInvocation).toHaveBeenCalledWith(expect.objectContaining({
        phase: 'rule_translation',
        status: 'failed',
        fallbackReason: 'rule_translation_model_unavailable_or_invalid',
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('应用已确认草稿时不重新调用模型，并写入草稿版本', async () => {
    const { update, snapshotInsert } = setupSupabase()

    const res = await POST(makeRequest({
      apply: true,
      source_model_invocation_id: 'invocation-1',
      translation: {
        target_field: 'payment_schedule',
        clause_category: 'payment',
        field_hints: ['首付款', '付款节奏'],
        semantic_prompt: '识别付款节奏是否偏离标准。',
        message_template: {
          comment: '建议调整付款节奏。',
          negotiation_action: '销售需与客户确认付款节点。',
        },
      },
    }), makeParams())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.applied).toBe(true)
    expect(mocks.generateTextWithFailover).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      target_field: 'payment_schedule',
      clause_category: 'payment',
      translation_status: 'ready',
      lifecycle_status: 'ready_to_publish',
      published_at: null,
    }))
    expect(snapshotInsert).toHaveBeenCalledWith(expect.objectContaining({
      rule_id: 'rule-1',
      version: 2,
      status: 'draft',
    }))
  })
})
