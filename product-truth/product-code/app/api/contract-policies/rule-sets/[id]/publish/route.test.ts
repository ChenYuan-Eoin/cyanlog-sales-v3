/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  configAccess: vi.fn(),
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: async (_req: unknown, handler: (user: { id: string }, orgId: string) => Promise<Response>) => (
    handler({ id: '33333333-3333-4333-8333-333333333333' }, '11111111-1111-4111-8111-111111111111')
  ),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from, rpc: mocks.rpc },
}))

vi.mock('@/lib/configs/access', () => ({
  userHasFreshOrgConfigAccess: mocks.configAccess,
}))

import { POST } from './route'

const ruleSetId = '22222222-2222-4222-8222-222222222222'

function request(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest
}

function queryResult(result: unknown) {
  const chain: any = {}
  ;['select', 'eq'].forEach((method) => {
    chain[method] = vi.fn().mockReturnValue(chain)
  })
  chain.single = vi.fn().mockResolvedValue(result)
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return chain
}

describe('POST /api/contract-policies/rule-sets/[id]/publish', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.configAccess.mockResolvedValue(true)
  })

  it('returns 403 before reading or publishing without fresh config:publish', async () => {
    mocks.configAccess.mockResolvedValue(false)

    const response = await POST(request({}), { params: Promise.resolve({ id: ruleSetId }) })
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toContain('config:publish')
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('publishes a complete canonical ruleset through the atomic database function', async () => {
    const ruleSetQuery = queryResult({
      data: { id: ruleSetId, name: '标准销售合同', lifecycle_status: 'ready_to_publish' },
      error: null,
    })
    const rulesQuery = queryResult({
      data: [{
        id: 'rule-1',
        code: 'PAYMENT_MINIMUM',
        name: '合同金额底线',
        org_id: '11111111-1111-4111-8111-111111111111',
        rule_set_id: ruleSetId,
        problem_category_id: '44444444-4444-4444-8444-444444444444',
        business_domain: 'contract_review',
        applicable_scenarios: ['standard_contract_review'],
        scope: 'org',
        is_active: true,
        lifecycle_status: 'ready_to_publish',
        translation_status: 'ready',
        rule_contract: {
          schema_version: '1.0',
          properties: [{ key: 'contract_amount', label: '合同金额', type: 'money', required: true, currency: 'CNY' }],
          decisions: [{
            id: 'amount_block',
            label: '低于底线',
            outcome: 'block',
            priority: 100,
            match: 'all',
            conditions: [{ property_key: 'contract_amount', operator: '<', value: 50000 }],
            action: '提交例外审批',
            message: '合同金额低于五万元。',
          }],
          missing_evidence_outcome: 'manual_review',
        },
      }],
      error: null,
    })
    mocks.from.mockImplementation((table: string) => (
      table === 'contract_rule_sets' ? ruleSetQuery : rulesQuery
    ))
    mocks.rpc.mockResolvedValue({
      data: { rule_set_id: ruleSetId, version: 2, rule_count: 1 },
      error: null,
    })

    const response = await POST(request({ release_note: '业务验收通过' }), {
      params: Promise.resolve({ id: ruleSetId }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('publish_contract_rule_set_v1', {
      p_org_id: '11111111-1111-4111-8111-111111111111',
      p_rule_set_id: ruleSetId,
      p_user_id: '33333333-3333-4333-8333-333333333333',
      p_release_note: '业务验收通过',
    })
    expect(body.data).toMatchObject({ rule_set_id: ruleSetId, version: 2, rule_count: 1 })
  })

  it('stops before the transaction when a canonical risk has no handling action', async () => {
    const ruleSetQuery = queryResult({ data: { id: ruleSetId, name: '标准销售合同' }, error: null })
    const rulesQuery = queryResult({
      data: [{
        code: 'PAYMENT_MINIMUM',
        name: '合同金额底线',
        rule_set_id: ruleSetId,
        problem_category_id: '44444444-4444-4444-8444-444444444444',
        business_domain: 'contract_review',
        applicable_scenarios: ['standard_contract_review'],
        scope: 'org',
        is_active: true,
        lifecycle_status: 'ready_to_publish',
        translation_status: 'ready',
        rule_contract: {
          schema_version: '1.0',
          properties: [{ key: 'contract_amount', label: '合同金额', type: 'money', required: true, currency: 'CNY' }],
          decisions: [{
            id: 'amount_block', label: '低于底线', outcome: 'block', priority: 100, match: 'all',
            conditions: [{ property_key: 'contract_amount', operator: '<', value: 50000 }],
          }],
          missing_evidence_outcome: 'manual_review',
        },
      }],
      error: null,
    })
    mocks.from.mockImplementation((table: string) => (
      table === 'contract_rule_sets' ? ruleSetQuery : rulesQuery
    ))

    const response = await POST(request({}), { params: Promise.resolve({ id: ruleSetId }) })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toContain('rule_contract.risk_handling')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it.each([
    'RULE_PUBLISHED_ACCEPTANCE_BINDING_MISSING:PAYMENT_MINIMUM',
    'RULE_PUBLISHED_ACCEPTANCE_DRAFT_INVALID:PAYMENT_MINIMUM',
    'RULE_PUBLISHED_ACCEPTANCE_BINDING_INVALID:PAYMENT_MINIMUM',
    'RULE_SET_CURRENT_SNAPSHOT_INVALID',
    'RULE_SET_FROZEN_ACCEPTANCE_INVALID',
  ])('maps %s to one safe snapshot-evidence recovery message', async (databaseMessage) => {
    const ruleSetQuery = queryResult({
      data: { id: ruleSetId, name: '标准销售合同', lifecycle_status: 'ready_to_publish' },
      error: null,
    })
    const rulesQuery = queryResult({
      data: [{
        id: 'rule-1',
        code: 'PAYMENT_MINIMUM',
        name: '合同金额底线',
        org_id: '11111111-1111-4111-8111-111111111111',
        rule_set_id: ruleSetId,
        problem_category_id: '44444444-4444-4444-8444-444444444444',
        business_domain: 'contract_review',
        applicable_scenarios: ['standard_contract_review'],
        scope: 'org',
        is_active: true,
        lifecycle_status: 'ready_to_publish',
        translation_status: 'ready',
        rule_contract: {
          schema_version: '1.0',
          properties: [{ key: 'contract_amount', label: '合同金额', type: 'money', required: true, currency: 'CNY' }],
          decisions: [{
            id: 'amount_block', label: '低于底线', outcome: 'block', priority: 100, match: 'all',
            conditions: [{ property_key: 'contract_amount', operator: '<', value: 50000 }],
            action: '提交例外审批', message: '合同金额低于五万元。',
          }],
          missing_evidence_outcome: 'manual_review',
        },
      }],
      error: null,
    })
    mocks.from.mockImplementation((table: string) => (
      table === 'contract_rule_sets' ? ruleSetQuery : rulesQuery
    ))
    mocks.rpc.mockResolvedValue({ data: null, error: { message: databaseMessage } })

    const response = await POST(request({}), { params: Promise.resolve({ id: ruleSetId }) })
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toBe('当前线上规则集验收证据链损坏，已阻止发布，请管理员恢复快照证据')
    expect(body.error.message).not.toContain(databaseMessage)
  })
})
