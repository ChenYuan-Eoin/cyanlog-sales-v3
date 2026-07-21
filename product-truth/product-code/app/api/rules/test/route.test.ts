import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  withAuthAndOrg: vi.fn(),
  executeRules: vi.fn(),
  loadFlexibleRules: vi.fn(),
  evaluateRuleContract: vi.fn(),
  resolveRuleContract: vi.fn(),
  normalizeRuleContract: vi.fn(),
  requiresMissingEvidenceCase: vi.fn(),
  from: vi.fn(),
  configAccess: vi.fn(),
  insert: vi.fn(),
  snapshotMaybeSingle: vi.fn(),
  persistedRuleSingle: vi.fn(),
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: mocks.withAuthAndOrg,
}))
vi.mock('@/lib/rules/engine', () => ({
  executeRules: mocks.executeRules,
  loadFlexibleRules: mocks.loadFlexibleRules,
}))
vi.mock('@/lib/rules/rule-contract', () => ({
  evaluateRuleContract: mocks.evaluateRuleContract,
  resolveRuleContract: mocks.resolveRuleContract,
  normalizeRuleContract: mocks.normalizeRuleContract,
  ruleContractRequiresMissingEvidenceCase: mocks.requiresMissingEvidenceCase,
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
vi.mock('@/lib/configs/access', () => ({
  userHasFreshOrgConfigAccess: mocks.configAccess,
}))

import { POST } from './route'
import { ruleContractSha256 } from '@/lib/rules/rule-release-readiness'

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
    mocks.withAuthAndOrg.mockImplementation(
      async (_req: NextRequest, handler: (user: { id: string }, orgId: string) => Promise<Response>) => (
        handler({ id: 'user-1' }, 'org-1')
      )
    )
    mocks.configAccess.mockResolvedValue(true)
    mocks.normalizeRuleContract.mockImplementation((value) => value)
    mocks.requiresMissingEvidenceCase.mockReturnValue(true)
    mocks.executeRules.mockResolvedValue({ risks: [], summary: 'ok', appliedRules: 1, matchedRules: 1 })
    mocks.resolveRuleContract.mockReturnValue({
      schema_version: '1.0',
      properties: [],
      decisions: [{ id: 'below_minimum', label: '低于最低金额', outcome: 'block', priority: 100, match: 'all', conditions: [] }],
      missing_evidence_outcome: 'manual_review',
    })
    mocks.snapshotMaybeSingle.mockResolvedValue({
      data: {
        id: 'snapshot-v3',
        status: 'draft',
        config_snapshot: {
          rule_contract: {
            schema_version: '1.0',
            properties: [],
            decisions: [{ id: 'below_minimum', label: '低于最低金额', outcome: 'block', priority: 100, match: 'all', conditions: [] }],
            missing_evidence_outcome: 'manual_review',
          },
        },
      },
      error: null,
    })
    mocks.persistedRuleSingle.mockResolvedValue({
      data: {
        rule_contract: {
          schema_version: '1.0',
          properties: [],
          decisions: [{ id: 'below_minimum', label: '低于最低金额', outcome: 'block', priority: 100, match: 'all', conditions: [] }],
          missing_evidence_outcome: 'manual_review',
        },
      },
      error: null,
    })
    const snapshotQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      in: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(),
      maybeSingle: mocks.snapshotMaybeSingle,
    }
    snapshotQuery.select.mockReturnValue(snapshotQuery)
    snapshotQuery.eq.mockReturnValue(snapshotQuery)
    snapshotQuery.in.mockReturnValue(snapshotQuery)
    snapshotQuery.order.mockReturnValue(snapshotQuery)
    snapshotQuery.limit.mockReturnValue(snapshotQuery)
    const persistedRuleQuery = {
      select: vi.fn(),
      eq: vi.fn(),
      single: mocks.persistedRuleSingle,
    }
    persistedRuleQuery.select.mockReturnValue(persistedRuleQuery)
    persistedRuleQuery.eq.mockReturnValue(persistedRuleQuery)
    const insertResult = {
      select: vi.fn(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'test-run-1', created_at: '2026-07-20T04:00:00.000Z' },
        error: null,
      }),
    }
    insertResult.select.mockReturnValue(insertResult)
    mocks.insert.mockReturnValue(insertResult)
    mocks.from.mockImplementation((table: string) => {
      if (table === 'contract_rule_snapshots') return snapshotQuery
      if (table === 'contract_rules_v2') return persistedRuleQuery
      return { insert: mocks.insert }
    })
  })

  it('checks organization permission before rejecting invalid JSON', async () => {
    const response = await POST(malformedRequest())
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toBe('文本长度需在 10-50000 字符之间')
    expect(mocks.configAccess).toHaveBeenCalledWith('user-1', 'org-1', 'write')
    expect(mocks.executeRules).not.toHaveBeenCalled()
  })

  it('uses the organization resolved by withAuthAndOrg for permission, rule lookup, and evidence', async () => {
    mocks.withAuthAndOrg.mockImplementationOnce(
      async (_req: NextRequest, handler: (user: { id: string }, orgId: string) => Promise<Response>) => (
        handler({ id: 'user-2' }, 'org-current')
      )
    )
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
      readings: {},
      evidence: [],
      missing_property_keys: [],
      ambiguous_property_keys: [],
      unit_conflict_property_keys: [],
    })

    const response = await POST(request({
      text: '本合同金额为40000元，双方确认按本合同约定履行。',
      rule_id: ruleId,
      case_kind: 'risk',
      expected_decision_id: 'below_minimum',
    }))

    expect(response.status).toBe(200)
    expect(mocks.configAccess).toHaveBeenCalledWith('user-2', 'org-current', 'write')
    expect(mocks.loadFlexibleRules).toHaveBeenCalledWith({ orgId: 'org-current', includeUnpublished: true })
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      org_id: 'org-current',
      tested_by: 'user-2',
    }))
  })

  it('returns 403 before parsing or running rules without fresh config:write', async () => {
    mocks.configAccess.mockResolvedValue(false)

    const response = await POST(request({ text: '本合同付款期限为三十天，双方按约履行。' }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error).toContain('config:write')
    expect(mocks.executeRules).not.toHaveBeenCalled()
    expect(mocks.loadFlexibleRules).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
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
      unit_conflict_property_keys: [],
    })

    const response = await POST(request({
      text: '本合同金额为40000元，双方确认按本合同约定履行。',
      rule_id: ruleId,
      case_kind: 'risk',
      expected_decision_id: 'below_minimum',
    }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.loadFlexibleRules).toHaveBeenCalledWith({ orgId: 'org-1', includeUnpublished: true })
    expect(mocks.executeRules).not.toHaveBeenCalled()
    expect(body.test).toEqual(expect.objectContaining({
      ruleId,
      outcome: 'block',
      riskLevel: 'red',
      missingPropertyKeys: [],
      unitConflictPropertyKeys: [],
      testRunId: 'test-run-1',
      assertion: expect.objectContaining({
        caseKind: 'risk',
        expectedDecisionId: 'below_minimum',
        passed: true,
      }),
    }))
    expect(body.test.readings[0]).toEqual(expect.objectContaining({
      property_key: 'contract_amount',
      value: 40000,
    }))
    expect(body.test.assertion).toEqual(expect.objectContaining({
      ruleSnapshotId: 'snapshot-v3',
      ruleContractSha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      evaluatorRevision: 'rule-contract-v1-20260720',
    }))
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      rule_snapshot_id: 'snapshot-v3',
      rule_contract_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      evaluator_revision: 'rule-contract-v1-20260720',
    }))
  })

  it('routes optional not_exists absence through its explicit decision instead of a generic missing test', async () => {
    const rule = { id: ruleId, code: 'RENEWAL_EXIT', name: '续约退出机制', version: 3 }
    mocks.loadFlexibleRules.mockResolvedValue([rule])
    mocks.requiresMissingEvidenceCase.mockReturnValue(false)

    const response = await POST(request({
      text: '合同仅约定自动续约，未填写任何退出机制的具体安排。',
      rule_id: ruleId,
      case_kind: 'missing_evidence',
    }))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error).toContain('明确判定处理“未填写”')
    expect(mocks.evaluateRuleContract).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('rejects a selected-rule test when the current row and snapshot contracts diverge', async () => {
    const rule = { id: ruleId, code: 'PAYMENT_MIN', name: '最低金额', version: 3 }
    mocks.loadFlexibleRules.mockResolvedValue([rule])
    mocks.snapshotMaybeSingle.mockResolvedValue({
      data: {
        id: 'snapshot-v3',
        status: 'draft',
        config_snapshot: {
          rule_contract: {
            schema_version: '1.0',
            properties: [],
            decisions: [{ id: 'different', label: '另一判定', outcome: 'pass', priority: 100, match: 'all', conditions: [] }],
            missing_evidence_outcome: 'manual_review',
          },
        },
      },
      error: null,
    })

    const response = await POST(request({
      text: '本合同金额为40000元，双方确认按本合同约定履行。',
      rule_id: ruleId,
      case_kind: 'risk',
      expected_decision_id: 'below_minimum',
    }))
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toContain('先保存')
    expect(mocks.evaluateRuleContract).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('binds evidence to exact persisted JSON instead of a normalized projection', async () => {
    const persistedContract = {
      schema_version: '1.0',
      properties: [],
      decisions: [{
        id: 'below_minimum', label: '低于最低金额', outcome: 'block', priority: 100, match: 'all', conditions: [],
        action: '', message: '',
      }],
      missing_evidence_outcome: 'manual_review',
    }
    mocks.persistedRuleSingle.mockResolvedValue({ data: { rule_contract: persistedContract }, error: null })
    mocks.snapshotMaybeSingle.mockResolvedValue({
      data: { id: 'snapshot-v3', status: 'draft', config_snapshot: { rule_contract: persistedContract } },
      error: null,
    })
    const rule = { id: ruleId, code: 'PAYMENT_MIN', name: '最低金额', version: 3 }
    mocks.loadFlexibleRules.mockResolvedValue([rule])
    mocks.evaluateRuleContract.mockReturnValue({
      status: 'decided', outcome: 'block', risk_level: 'red',
      decision: { id: 'below_minimum', label: '低于最低金额', match: 'all', outcome: 'block' },
      readings: {}, evidence: [], missing_property_keys: [], ambiguous_property_keys: [], unit_conflict_property_keys: [],
    })

    const response = await POST(request({
      text: '本合同金额为40000元，双方确认按本合同约定履行。',
      rule_id: ruleId,
      case_kind: 'risk',
      expected_decision_id: 'below_minimum',
    }))

    expect(response.status).toBe(200)
    const inserted = mocks.insert.mock.calls[0]?.[0]
    expect(inserted.rule_contract_sha256).toBe(ruleContractSha256(persistedContract))
    expect(inserted.rule_contract_sha256).not.toBe(ruleContractSha256({
      ...persistedContract,
      decisions: persistedContract.decisions.map(({ action: _action, message: _message, ...decision }) => decision),
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
