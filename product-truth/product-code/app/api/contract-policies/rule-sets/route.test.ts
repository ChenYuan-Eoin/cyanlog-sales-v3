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
import { ruleContractSha256 } from '@/lib/rules/rule-release-readiness'

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
      rule_contract_sha256: ruleContractSha256(ruleContract as any), evaluator_revision: 'rule-contract-v1-20260720',
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
      rule_snapshot_ids: ['published-v1'],
    }])
    const publishedRefsQuery = queryResult([{
      id: 'published-v1', rule_id: 'rule-1', version: 1,
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
