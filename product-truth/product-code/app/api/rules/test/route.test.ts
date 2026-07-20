import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  getDefaultOrgId: vi.fn(),
  executeRules: vi.fn(),
  loadFlexibleRules: vi.fn(),
  evaluateRuleContract: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/scoped-access', () => ({ getDefaultOrgId: mocks.getDefaultOrgId }))
vi.mock('@/lib/rules/engine', () => ({
  executeRules: mocks.executeRules,
  loadFlexibleRules: mocks.loadFlexibleRules,
}))
vi.mock('@/lib/rules/rule-contract', () => ({
  evaluateRuleContract: mocks.evaluateRuleContract,
}))

import { POST } from './route'

const ruleId = '11111111-1111-4111-8111-111111111111'

function request(body: unknown) {
  return { json: async () => body } as unknown as NextRequest
}

function malformedRequest() {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
  } as unknown as NextRequest
}

describe('POST /api/rules/test', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAuth.mockResolvedValue({ id: 'user-1' })
    mocks.getDefaultOrgId.mockResolvedValue('org-1')
    mocks.executeRules.mockResolvedValue({ risks: [], summary: 'ok', appliedRules: 1, matchedRules: 1 })
  })

  it('rejects invalid JSON before loading the organization or rule engine', async () => {
    const response = await POST(malformedRequest())
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('文本长度需在 10-50000 字符之间')
    expect(mocks.getDefaultOrgId).not.toHaveBeenCalled()
    expect(mocks.executeRules).not.toHaveBeenCalled()
  })

  it('keeps the legacy all-published-rules response when no rule_id is provided', async () => {
    const response = await POST(request({ text: '本合同付款期限为三十天，双方按约履行。' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.summary).toBe('ok')
    expect(body.test).toBeUndefined()
    expect(mocks.loadFlexibleRules).not.toHaveBeenCalled()
  })

  it('tests a selected draft rule and returns property readings plus the matched decision', async () => {
    const rule = { id: ruleId, code: 'PAYMENT_MIN', name: '最低金额', version: 3 }
    mocks.loadFlexibleRules.mockResolvedValue([rule])
    mocks.evaluateRuleContract.mockReturnValue({
      status: 'decided',
      outcome: 'block',
      risk_level: 'red',
      decision: {
        id: 'below_minimum',
        label: '低于最低金额',
        match: 'all',
        outcome: 'block',
        action: '提交例外审批',
        message: '合同金额低于公司标准',
      },
      readings: {
        contract_amount: {
          property_key: 'contract_amount',
          status: 'read',
          value: 40000,
          unit: 'CNY',
          evidence: '合同金额为40000元',
          confidence: 0.95,
        },
      },
      evidence: ['合同金额为40000元'],
      missing_property_keys: [],
      ambiguous_property_keys: [],
    })

    const response = await POST(request({
      text: '本合同金额为40000元，双方确认按本合同约定履行。',
      rule_id: ruleId,
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.loadFlexibleRules).toHaveBeenCalledWith({ orgId: 'org-1', includeUnpublished: true })
    expect(body.test).toEqual(expect.objectContaining({
      ruleId,
      outcome: 'block',
      riskLevel: 'red',
      missingPropertyKeys: [],
    }))
    expect(body.test.readings[0]).toEqual(expect.objectContaining({
      property_key: 'contract_amount',
      value: 40000,
    }))
  })

  it('does not allow a rule from outside the current organization to be tested', async () => {
    mocks.loadFlexibleRules.mockResolvedValue([])

    const response = await POST(request({
      text: '本合同金额为40000元，双方确认按本合同约定履行。',
      rule_id: ruleId,
    }))
    const body = await response.json()

    expect(response.status).toBe(404)
    expect(body.error).toContain('当前组织')
    expect(mocks.evaluateRuleContract).not.toHaveBeenCalled()
  })
})
