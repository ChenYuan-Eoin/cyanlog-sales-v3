/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  configAccess: vi.fn(),
}))

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: async (_req: unknown, handler: (user: { id: string }, orgId: string) => Promise<Response>) => (
    handler({ id: 'user-1' }, 'org-1')
  ),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: mocks.from },
}))

vi.mock('@/lib/configs/access', () => ({
  userHasFreshOrgConfigAccess: mocks.configAccess,
}))

import { GET } from './route'
import {
  RULE_CONTRACT_EVALUATOR_REVISION,
  ruleContractSha256,
} from '@/lib/rules/rule-release-readiness'

function request(): NextRequest {
  return {} as NextRequest
}

function queryResult(data: unknown) {
  const result = { data, error: null }
  const chain: any = {}
  ;['select', 'eq', 'neq', 'order', 'in'].forEach((method) => {
    chain[method] = vi.fn().mockReturnValue(chain)
  })
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return chain
}

const ruleContract = {
  schema_version: '1.0',
  properties: [{ key: 'amount', label: '合同金额', type: 'money', required: true, currency: 'CNY' }],
  decisions: [
    { id: 'low', label: '低于底线', outcome: 'block', priority: 200, match: 'all', conditions: [{ property_key: 'amount', operator: '<', value: 50000, unit: 'CNY' }] },
    { id: 'ok', label: '达到底线', outcome: 'pass', priority: 100, match: 'all', conditions: [{ property_key: 'amount', operator: '>=', value: 50000, unit: 'CNY' }] },
  ],
  missing_evidence_outcome: 'manual_review',
}

const ruleContractHash = ruleContractSha256(ruleContract as any)

function publishedEvidence(
  acceptedDraftSnapshotId: string,
  contractSha256 = ruleContractHash,
  evaluatorRevision = RULE_CONTRACT_EVALUATOR_REVISION
) {
  return {
    _release_evidence: {
      accepted_draft_snapshot_id: acceptedDraftSnapshotId,
      rule_contract_sha256: contractSha256,
      evaluator_revision: evaluatorRevision,
    },
  }
}

function acceptanceRuns(input: {
  ruleId: string
  ruleVersion: number
  ruleSnapshotId: string
  sequence: number
}) {
  const base = {
    rule_id: input.ruleId,
    rule_version: input.ruleVersion,
    rule_snapshot_id: input.ruleSnapshotId,
    rule_contract_sha256: ruleContractHash,
    evaluator_revision: RULE_CONTRACT_EVALUATOR_REVISION,
  }
  const cases = [
    { case_kind: 'risk', expected_status: 'decided', expected_outcome: 'block', expected_decision_id: 'low' },
    { case_kind: 'pass', expected_status: 'decided', expected_outcome: 'pass', expected_decision_id: 'ok' },
    { case_kind: 'missing_evidence', expected_status: 'missing_evidence', expected_outcome: 'manual_review', expected_decision_id: null },
    { case_kind: 'value_conflict', expected_status: 'missing_evidence', expected_outcome: 'manual_review', expected_decision_id: null },
    { case_kind: 'unit_conflict', expected_status: 'missing_evidence', expected_outcome: 'manual_review', expected_decision_id: null },
  ]
  return cases.map((testCase, index) => ({
    ...base,
    ...testCase,
    id: `run-${input.sequence}-${index + 1}`,
    assertion_passed: true,
    created_at: `2026-07-20T10:${String(input.sequence).padStart(2, '0')}:${String(index).padStart(2, '0')}.000Z`,
  }))
}

function frozenRuns(input: Parameters<typeof acceptanceRuns>[0]) {
  return acceptanceRuns(input).map(({ rule_id: _ruleId, rule_version: _ruleVersion, ...run }) => run)
}

describe('GET /api/contract-policies/rule-sets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.configAccess.mockResolvedValue(true)
  })

  it('uses the latest snapshot-bound run, including a failed retry, for publish readiness', async () => {
    const setsQuery = queryResult([{
      id: 'set-1', org_id: 'org-1', code: 'STANDARD', name: '标准规则集',
      description: null, applicable_scenario: 'standard_contract_review', priority: 100,
      is_default: true, is_active: true, version: 1, lifecycle_status: 'ready_to_publish',
      translation_status: 'ready', published_at: '2026-07-19T00:00:00.000Z',
      published_by: 'user-1', current_snapshot_id: 'set-snapshot-v1', release_note: null, metadata: {},
      created_by: 'user-1', created_at: '2026-07-19T00:00:00.000Z', updated_at: '2026-07-20T00:00:00.000Z',
    }])
    const documentsQuery = queryResult([])
    const rulesQuery = queryResult([{
      id: 'rule-1', code: 'PAYMENT_MIN', rule_set_id: 'set-1', problem_category_id: 'category-1',
      rule_contract: ruleContract, version: 2, lifecycle_status: 'ready_to_publish',
      translation_status: 'ready', is_active: true, published_at: null,
    }])
    const baseRun = {
      rule_id: 'rule-1', rule_version: 2, rule_snapshot_id: 'draft-v2',
      rule_contract_sha256: ruleContractHash, evaluator_revision: RULE_CONTRACT_EVALUATOR_REVISION,
    }
    const testRunsQuery = queryResult([
      { ...baseRun, id: 'run-1', created_at: '2026-07-20T10:00:00.000Z', case_kind: 'risk', expected_status: 'decided', expected_outcome: 'block', expected_decision_id: 'low', assertion_passed: true },
      { ...baseRun, id: 'run-2', created_at: '2026-07-20T10:01:00.000Z', case_kind: 'pass', expected_status: 'decided', expected_outcome: 'pass', expected_decision_id: 'ok', assertion_passed: true },
      { ...baseRun, id: 'run-3', created_at: '2026-07-20T10:02:00.000Z', case_kind: 'missing_evidence', expected_status: 'missing_evidence', expected_outcome: 'manual_review', expected_decision_id: null, assertion_passed: true },
      { ...baseRun, id: 'run-4', created_at: '2026-07-20T10:03:00.000Z', case_kind: 'value_conflict', expected_status: 'missing_evidence', expected_outcome: 'manual_review', expected_decision_id: null, assertion_passed: true },
      { ...baseRun, id: 'run-5', created_at: '2026-07-20T10:04:00.000Z', case_kind: 'unit_conflict', expected_status: 'missing_evidence', expected_outcome: 'manual_review', expected_decision_id: null, assertion_passed: true },
      { ...baseRun, id: 'run-6', created_at: '2026-07-20T10:05:00.000Z', case_kind: 'risk', expected_status: 'decided', expected_outcome: 'block', expected_decision_id: 'low', assertion_passed: false },
    ])
    const setSnapshotsQuery = queryResult([{
      id: 'set-snapshot-v1', org_id: 'org-1', rule_set_id: 'set-1', status: 'published',
      rule_snapshot_ids: ['published-v1'], test_results: {},
    }])
    const publishedRefsQuery = queryResult([{
      id: 'published-v1', rule_id: 'rule-1', version: 1,
      config_snapshot: publishedEvidence('accepted-draft-v1'),
    }])
    const bindingQuery = queryResult([{
      id: 'draft-v2', rule_id: 'rule-1', version: 2, status: 'draft', created_at: '2026-07-20T09:00:00.000Z',
    }])
    const snapshotQueries = [publishedRefsQuery, bindingQuery]
    const tables: Record<string, any> = {
      contract_rule_sets: setsQuery,
      contract_rule_set_documents: documentsQuery,
      contract_rules_v2: rulesQuery,
      contract_rule_test_runs: testRunsQuery,
      contract_rule_set_snapshots: setSnapshotsQuery,
    }
    mocks.from.mockImplementation((table: string) => table === 'contract_rule_snapshots'
      ? snapshotQueries.shift()
      : tables[table])

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data[0]).toEqual(expect.objectContaining({
      required_test_case_count: 5,
      passed_test_case_count: 4,
      test_evidence_ready_rule_count: 0,
      can_publish: false,
    }))
    expect(body.data[0].publish_blockers.join(' ')).toContain('低于底线')
    expect(testRunsQuery.select).toHaveBeenCalledWith(expect.stringContaining('evaluator_revision'))
    expect(testRunsQuery.eq).toHaveBeenCalledTimes(1)
    expect(testRunsQuery.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(setSnapshotsQuery.in).toHaveBeenCalledWith('id', ['set-snapshot-v1'])
    expect(publishedRefsQuery.eq).toHaveBeenCalledWith('status', 'published')
    expect(bindingQuery.eq).toHaveBeenCalledWith('status', 'draft')
  })

  it('reuses frozen evidence for 14 unchanged rules when live history is failed or cleared and 1 of 15 changes', async () => {
    const rules = Array.from({ length: 15 }, (_, index) => {
      const number = index + 1
      const changed = number === 1
      return {
        id: `rule-${number}`,
        code: `RULE_${number}`,
        rule_set_id: 'set-1',
        problem_category_id: `category-${number}`,
        rule_contract: ruleContract,
        version: changed ? 2 : 1,
        lifecycle_status: changed ? 'ready_to_publish' : 'published',
        translation_status: 'ready',
        is_active: true,
        published_at: changed ? null : '2026-07-19T00:00:00.000Z',
      }
    })
    const publishedSnapshots = Array.from({ length: 15 }, (_, index) => {
      const number = index + 1
      return {
        id: `published-v1-rule-${number}`,
        rule_id: `rule-${number}`,
        version: 1,
        config_snapshot: publishedEvidence(`accepted-draft-v1-rule-${number}`),
      }
    })
    const currentDraftRuns = acceptanceRuns({
      ruleId: 'rule-1',
      ruleVersion: 2,
      ruleSnapshotId: 'accepted-draft-v2-rule-1',
      sequence: 1,
    })
    const appendedHistoricalFailures = rules.slice(1, 8).map((rule, index) => ({
      ...acceptanceRuns({
        ruleId: rule.id,
        ruleVersion: rule.version,
        ruleSnapshotId: `accepted-draft-v1-rule-${index + 2}`,
        sequence: index + 2,
      })[0],
      id: `later-failed-run-${index + 2}`,
      assertion_passed: false,
      created_at: `2026-07-21T11:${String(index).padStart(2, '0')}:00.000Z`,
    }))
    const testRunsQuery = queryResult([...currentDraftRuns, ...appendedHistoricalFailures])
    const frozenRuleRuns = Object.fromEntries(rules.slice(1).map((rule, index) => [
      rule.id,
      frozenRuns({
        ruleId: rule.id,
        ruleVersion: rule.version,
        ruleSnapshotId: `accepted-draft-v1-rule-${index + 2}`,
        sequence: index + 2,
      }),
    ]))
    const publishedRefsQuery = queryResult(publishedSnapshots)
    const bindingQuery = queryResult([{
      id: 'accepted-draft-v2-rule-1',
      rule_id: 'rule-1',
      version: 2,
      status: 'draft',
      created_at: '2026-07-20T09:00:00.000Z',
    }])
    const snapshotQueries = [publishedRefsQuery, bindingQuery]
    const tables: Record<string, any> = {
      contract_rule_sets: queryResult([{
        id: 'set-1', org_id: 'org-1', code: 'STANDARD', name: '标准规则集',
        description: null, applicable_scenario: 'contract_review', priority: 100,
        is_default: true, is_active: true, version: 2, lifecycle_status: 'ready_to_publish',
        translation_status: 'ready', published_at: '2026-07-19T00:00:00.000Z',
        published_by: 'user-1', current_snapshot_id: 'set-snapshot-v1', release_note: null, metadata: {},
        created_by: 'user-1', created_at: '2026-07-19T00:00:00.000Z', updated_at: '2026-07-20T00:00:00.000Z',
      }]),
      contract_rule_set_documents: queryResult([]),
      contract_rules_v2: queryResult(rules),
      contract_rule_test_runs: testRunsQuery,
      contract_rule_set_snapshots: queryResult([{
        id: 'set-snapshot-v1', org_id: 'org-1', rule_set_id: 'set-1', status: 'published',
        rule_snapshot_ids: publishedSnapshots.map((snapshot) => snapshot.id),
        test_results: {
          gate: 'snapshot_bound_latest_asserted_rule_matrix',
          rule_count: 15,
          rule_runs: frozenRuleRuns,
        },
      }]),
    }
    mocks.from.mockImplementation((table: string) => table === 'contract_rule_snapshots'
      ? snapshotQueries.shift()
      : tables[table])

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data[0]).toEqual(expect.objectContaining({
      rule_count: 15,
      required_test_case_count: 75,
      passed_test_case_count: 75,
      test_evidence_ready_rule_count: 15,
      can_publish: true,
      publish_blockers: [],
    }))
    expect(body.data[0].active_rule_versions['rule-1']).toBe(1)
    expect(publishedRefsQuery.select).toHaveBeenCalledWith(expect.stringContaining('config_snapshot'))
    expect(testRunsQuery.in).toHaveBeenCalledWith('rule_id', ['rule-1'])
  })

  it.each([
    ['missing config snapshot', undefined],
    ['missing release evidence', {}],
    ['blank accepted draft id', publishedEvidence('   ')],
    ['non-string accepted draft id', {
      _release_evidence: {
        accepted_draft_snapshot_id: 42,
        rule_contract_sha256: ruleContractHash,
        evaluator_revision: RULE_CONTRACT_EVALUATOR_REVISION,
      },
    }],
  ])('fails closed when a published member has %s', async (_label, configSnapshot) => {
    const snapshotQueries = [
      queryResult([{
        id: 'published-v1', rule_id: 'rule-1', version: 1,
        config_snapshot: configSnapshot,
      }]),
      queryResult([]),
    ]
    const tables: Record<string, any> = {
      contract_rule_sets: queryResult([{
        id: 'set-1', org_id: 'org-1', code: 'STANDARD', name: '标准规则集',
        is_active: true, version: 1, lifecycle_status: 'published', translation_status: 'ready',
        published_at: '2026-07-19T00:00:00.000Z', current_snapshot_id: 'set-snapshot-v1',
      }]),
      contract_rule_set_documents: queryResult([]),
      contract_rules_v2: queryResult([{
        id: 'rule-1', code: 'RULE_1', rule_set_id: 'set-1', problem_category_id: 'category-1',
        rule_contract: ruleContract, version: 1, lifecycle_status: 'published', translation_status: 'ready',
        is_active: true, published_at: '2026-07-19T00:00:00.000Z',
      }]),
      contract_rule_test_runs: queryResult([]),
      contract_rule_set_snapshots: queryResult([{
        id: 'set-snapshot-v1', org_id: 'org-1', rule_set_id: 'set-1', status: 'published',
        rule_snapshot_ids: ['published-v1'],
      }]),
    }
    mocks.from.mockImplementation((table: string) => table === 'contract_rule_snapshots'
      ? snapshotQueries.shift()
      : tables[table])

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(JSON.stringify(body)).toContain('规则集当前发布成员缺少不可变验收证据')
  })

  it.each([
    ['missing test results', undefined],
    ['missing rule runs', { gate: 'snapshot_bound_latest_asserted_rule_matrix' }],
    ['missing current rule matrix', { gate: 'snapshot_bound_latest_asserted_rule_matrix', rule_runs: {} }],
    ['non-array current rule matrix', { gate: 'snapshot_bound_latest_asserted_rule_matrix', rule_runs: { 'rule-1': 'invalid' } }],
    ['incomplete current rule matrix', {
      gate: 'snapshot_bound_latest_asserted_rule_matrix',
      rule_runs: {
        'rule-1': frozenRuns({
          ruleId: 'rule-1', ruleVersion: 1, ruleSnapshotId: 'accepted-draft-v1', sequence: 1,
        }).slice(0, 4),
      },
    }],
    ['matrix bound to another accepted draft', {
      gate: 'snapshot_bound_latest_asserted_rule_matrix',
      rule_runs: {
        'rule-1': frozenRuns({
          ruleId: 'rule-1', ruleVersion: 1, ruleSnapshotId: 'different-draft', sequence: 1,
        }),
      },
    }],
    ['matrix with a failed frozen row', {
      gate: 'snapshot_bound_latest_asserted_rule_matrix',
      rule_runs: {
        'rule-1': frozenRuns({
          ruleId: 'rule-1', ruleVersion: 1, ruleSnapshotId: 'accepted-draft-v1', sequence: 1,
        }).map((run, index) => index === 0 ? { ...run, assertion_passed: false } : run),
      },
    }],
  ])('fails closed for frozen acceptance evidence with %s', async (_label, testResults) => {
    const snapshotQueries = [
      queryResult([{
        id: 'published-v1', rule_id: 'rule-1', version: 1,
        config_snapshot: publishedEvidence('accepted-draft-v1'),
      }]),
      queryResult([]),
    ]
    const tables: Record<string, any> = {
      contract_rule_sets: queryResult([{
        id: 'set-1', org_id: 'org-1', code: 'STANDARD', name: '标准规则集',
        is_active: true, version: 1, lifecycle_status: 'published', translation_status: 'ready',
        published_at: '2026-07-19T00:00:00.000Z', current_snapshot_id: 'set-snapshot-v1',
      }]),
      contract_rule_set_documents: queryResult([]),
      contract_rules_v2: queryResult([{
        id: 'rule-1', code: 'RULE_1', rule_set_id: 'set-1', problem_category_id: 'category-1',
        rule_contract: ruleContract, version: 1, lifecycle_status: 'published', translation_status: 'ready',
        is_active: true, published_at: '2026-07-19T00:00:00.000Z',
      }]),
      contract_rule_set_snapshots: queryResult([{
        id: 'set-snapshot-v1', org_id: 'org-1', rule_set_id: 'set-1', status: 'published',
        rule_snapshot_ids: ['published-v1'], test_results: testResults,
      }]),
    }
    mocks.from.mockImplementation((table: string) => table === 'contract_rule_snapshots'
      ? snapshotQueries.shift()
      : tables[table])

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(JSON.stringify(body)).toContain('规则集当前发布成员冻结验收矩阵缺失或损坏')
    expect(mocks.from).not.toHaveBeenCalledWith('contract_rule_test_runs')
  })

  it.each([
    ['contract hash mismatch', publishedEvidence('accepted-draft-v1', 'wrong-contract-hash')],
    ['evaluator mismatch', publishedEvidence('accepted-draft-v1', ruleContractHash, 'obsolete-evaluator')],
  ])('fails closed when published release evidence has %s', async (_label, configSnapshot) => {
    const snapshotQueries = [
      queryResult([{
        id: 'published-v1', rule_id: 'rule-1', version: 1, config_snapshot: configSnapshot,
      }]),
      queryResult([]),
    ]
    const tables: Record<string, any> = {
      contract_rule_sets: queryResult([{
        id: 'set-1', org_id: 'org-1', code: 'STANDARD', name: '标准规则集',
        is_active: true, version: 1, lifecycle_status: 'published', translation_status: 'ready',
        published_at: '2026-07-19T00:00:00.000Z', current_snapshot_id: 'set-snapshot-v1',
      }]),
      contract_rule_set_documents: queryResult([]),
      contract_rules_v2: queryResult([{
        id: 'rule-1', code: 'RULE_1', rule_set_id: 'set-1', problem_category_id: 'category-1',
        rule_contract: ruleContract, version: 1, lifecycle_status: 'published', translation_status: 'ready',
        is_active: true, published_at: '2026-07-19T00:00:00.000Z',
      }]),
      contract_rule_set_snapshots: queryResult([{
        id: 'set-snapshot-v1', org_id: 'org-1', rule_set_id: 'set-1', status: 'published',
        rule_snapshot_ids: ['published-v1'],
        test_results: {
          gate: 'snapshot_bound_latest_asserted_rule_matrix',
          rule_runs: {
            'rule-1': frozenRuns({
              ruleId: 'rule-1', ruleVersion: 1, ruleSnapshotId: 'accepted-draft-v1', sequence: 1,
            }),
          },
        },
      }]),
    }
    mocks.from.mockImplementation((table: string) => table === 'contract_rule_snapshots'
      ? snapshotQueries.shift()
      : tables[table])

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(JSON.stringify(body)).toContain('规则集当前发布成员冻结验收矩阵缺失或损坏')
    expect(mocks.from).not.toHaveBeenCalledWith('contract_rule_test_runs')
  })

  it('fails closed when a released RuleSet has no current snapshot pointer', async () => {
    const tables: Record<string, any> = {
      contract_rule_sets: queryResult([{
        id: 'set-1', org_id: 'org-1', code: 'STANDARD', name: '标准规则集',
        is_active: true, published_at: '2026-07-19T00:00:00.000Z', current_snapshot_id: null,
      }]),
      contract_rule_set_documents: queryResult([]),
      contract_rules_v2: queryResult([]),
      contract_rule_test_runs: queryResult([]),
    }
    mocks.from.mockImplementation((table: string) => tables[table])

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(JSON.stringify(body)).toContain('规则集当前发布指针缺失或状态不一致')
    expect(mocks.from).not.toHaveBeenCalledWith('contract_rule_set_snapshots')
  })

  it('fails closed when a RuleSet has a current pointer but no published_at', async () => {
    const tables: Record<string, any> = {
      contract_rule_sets: queryResult([{
        id: 'set-1', org_id: 'org-1', code: 'STANDARD', name: '标准规则集',
        is_active: true, published_at: null, current_snapshot_id: 'set-snapshot-v1',
      }]),
      contract_rule_set_documents: queryResult([]),
      contract_rules_v2: queryResult([]),
      contract_rule_test_runs: queryResult([]),
    }
    mocks.from.mockImplementation((table: string) => tables[table])

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(JSON.stringify(body)).toContain('规则集当前发布指针缺失或状态不一致')
    expect(mocks.from).not.toHaveBeenCalledWith('contract_rule_set_snapshots')
  })

  it('fails closed for each empty, blank or duplicate current membership', async () => {
    for (const memberIds of [
      [],
      ['published-v1', ''],
      ['published-v1', 'published-v1'],
    ]) {
      vi.clearAllMocks()
      mocks.configAccess.mockResolvedValue(true)
      const setSnapshotsQuery = queryResult([{
        id: 'set-snapshot-v1', org_id: 'org-1', rule_set_id: 'set-1', status: 'published',
        rule_snapshot_ids: memberIds,
      }])
      const tables: Record<string, any> = {
        contract_rule_sets: queryResult([{
          id: 'set-1', org_id: 'org-1', code: 'STANDARD', name: '标准规则集',
          is_active: true, published_at: '2026-07-19T00:00:00.000Z',
          current_snapshot_id: 'set-snapshot-v1',
        }]),
        contract_rule_set_documents: queryResult([]),
        contract_rules_v2: queryResult([]),
        contract_rule_test_runs: queryResult([]),
        contract_rule_set_snapshots: setSnapshotsQuery,
      }
      mocks.from.mockImplementation((table: string) => tables[table])

      const response = await GET(request())
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(JSON.stringify(body)).toContain('规则集当前发布成员清单无效')
    }
  })

  it('fails closed instead of guessing another published RuleSetSnapshot when pointer membership mismatches', async () => {
    const setSnapshotsQuery = queryResult([{
      id: 'set-snapshot-v1', org_id: 'org-1', rule_set_id: 'different-set', status: 'published',
      rule_snapshot_ids: [],
    }])
    const tables: Record<string, any> = {
      contract_rule_sets: queryResult([{
        id: 'set-1', org_id: 'org-1', code: 'STANDARD', name: '标准规则集',
        is_active: true, published_at: '2026-07-19T00:00:00.000Z',
        current_snapshot_id: 'set-snapshot-v1',
      }]),
      contract_rule_set_documents: queryResult([]),
      contract_rules_v2: queryResult([]),
      contract_rule_test_runs: queryResult([]),
      contract_rule_set_snapshots: setSnapshotsQuery,
    }
    mocks.from.mockImplementation((table: string) => tables[table])

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(JSON.stringify(body)).toContain('规则集当前发布指针无效')
    expect(setSnapshotsQuery.in).toHaveBeenCalledWith('id', ['set-snapshot-v1'])
  })

  it('fails closed when the current RuleSetSnapshot contains a rule owned by another RuleSet', async () => {
    const setSnapshotsQuery = queryResult([{
      id: 'set-snapshot-v1', org_id: 'org-1', rule_set_id: 'set-1', status: 'published',
      rule_snapshot_ids: ['published-v1'],
    }])
    const snapshotQueries = [
      queryResult([{ id: 'published-v1', rule_id: 'rule-foreign', version: 1 }]),
      queryResult([]),
    ]
    const tables: Record<string, any> = {
      contract_rule_sets: queryResult([{
        id: 'set-1', org_id: 'org-1', code: 'STANDARD', name: '标准规则集',
        is_active: true, published_at: '2026-07-19T00:00:00.000Z',
        current_snapshot_id: 'set-snapshot-v1',
      }]),
      contract_rule_set_documents: queryResult([]),
      contract_rules_v2: queryResult([{
        id: 'rule-foreign', code: 'FOREIGN', rule_set_id: 'set-2', version: 1,
        lifecycle_status: 'published', translation_status: 'ready', is_active: true,
        published_at: '2026-07-19T00:00:00.000Z',
      }]),
      contract_rule_test_runs: queryResult([]),
      contract_rule_set_snapshots: setSnapshotsQuery,
    }
    mocks.from.mockImplementation((table: string) => table === 'contract_rule_snapshots'
      ? snapshotQueries.shift()
      : tables[table])

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(JSON.stringify(body)).toContain('规则集当前发布成员与规则集不一致')
  })
})
