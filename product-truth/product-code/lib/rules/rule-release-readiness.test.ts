import { describe, expect, it } from 'vitest'
import {
  RULE_CONTRACT_EVALUATOR_REVISION,
  ruleContractSha256,
  ruleReleaseReadiness,
  ruleReleaseRequirements,
} from './rule-release-readiness'

const contract = {
  schema_version: '1.0' as const,
  properties: [{ key: 'amount', label: '合同金额', type: 'money' as const, required: true, currency: 'CNY' }],
  decisions: [
    { id: 'low', label: '低于底线', outcome: 'block' as const, priority: 200, match: 'all' as const, conditions: [{ property_key: 'amount', operator: '<' as const, value: 50000, unit: 'CNY' }] },
    { id: 'ok', label: '达到底线', outcome: 'pass' as const, priority: 100, match: 'all' as const, conditions: [{ property_key: 'amount', operator: '>=' as const, value: 50000, unit: 'CNY' }] },
  ],
  missing_evidence_outcome: 'manual_review' as const,
}

describe('rule release readiness', () => {
  it('requires every decision plus missing, value-conflict and money currency-conflict cases', () => {
    expect(ruleReleaseRequirements(contract).map((item) => item.key)).toEqual([
      'decision:low',
      'decision:ok',
      'missing_evidence',
      'value_conflict',
      'unit_conflict',
    ])
  })

  it('does not treat a merely executed or wrong-decision run as acceptance', () => {
    const result = ruleReleaseReadiness({
      ruleId: 'rule-1',
      ruleVersion: 2,
      ruleContract: contract,
      runs: [{
        rule_id: 'rule-1', rule_version: 2, case_kind: 'risk', expected_status: 'decided',
        expected_outcome: 'block', expected_decision_id: 'low', assertion_passed: false,
      }],
    })
    expect(result.complete).toBe(false)
    expect(result.passedCount).toBe(0)
  })

  it('accepts only an exact same-version asserted matrix', () => {
    const base = {
      rule_id: 'rule-1',
      rule_version: 2,
      assertion_passed: true,
      expected_status: 'decided',
      rule_snapshot_id: 'snapshot-v2',
      rule_contract_sha256: ruleContractSha256(contract),
      evaluator_revision: RULE_CONTRACT_EVALUATOR_REVISION,
      created_at: '2026-07-20T10:00:00.000Z',
    }
    const result = ruleReleaseReadiness({
      ruleId: 'rule-1',
      ruleVersion: 2,
      ruleContract: contract,
      ruleSnapshotId: 'snapshot-v2',
      ruleContractSha256: ruleContractSha256(contract),
      evaluatorRevision: RULE_CONTRACT_EVALUATOR_REVISION,
      runs: [
        { ...base, case_kind: 'risk', expected_outcome: 'block', expected_decision_id: 'low' },
        { ...base, case_kind: 'pass', expected_outcome: 'pass', expected_decision_id: 'ok' },
        { ...base, case_kind: 'missing_evidence', expected_status: 'missing_evidence', expected_outcome: 'manual_review' },
        { ...base, case_kind: 'value_conflict', expected_status: 'missing_evidence', expected_outcome: 'manual_review' },
        { ...base, case_kind: 'unit_conflict', expected_status: 'missing_evidence', expected_outcome: 'manual_review' },
      ],
    })
    expect(result).toMatchObject({ complete: true, requiredCount: 5, passedCount: 5, missingLabels: [] })
  })

  it('uses the newest same-case decision run so a failed retry revokes an old pass', () => {
    const binding = {
      rule_id: 'rule-1',
      rule_version: 2,
      rule_snapshot_id: 'snapshot-v2',
      evaluator_revision: RULE_CONTRACT_EVALUATOR_REVISION,
    }
    const matrix = [
      { ...binding, id: '1', created_at: '2026-07-20T10:00:00.000Z', case_kind: 'risk' as const, expected_status: 'decided', expected_outcome: 'block' as const, expected_decision_id: 'low', assertion_passed: true },
      { ...binding, id: '2', created_at: '2026-07-20T10:01:00.000Z', case_kind: 'pass' as const, expected_status: 'decided', expected_outcome: 'pass' as const, expected_decision_id: 'ok', assertion_passed: true },
      { ...binding, id: '3', created_at: '2026-07-20T10:02:00.000Z', case_kind: 'missing_evidence' as const, expected_status: 'missing_evidence', expected_outcome: 'manual_review' as const, assertion_passed: true },
      { ...binding, id: '4', created_at: '2026-07-20T10:03:00.000Z', case_kind: 'value_conflict' as const, expected_status: 'missing_evidence', expected_outcome: 'manual_review' as const, assertion_passed: true },
      { ...binding, id: '5', created_at: '2026-07-20T10:04:00.000Z', case_kind: 'unit_conflict' as const, expected_status: 'missing_evidence', expected_outcome: 'manual_review' as const, assertion_passed: true },
      { ...binding, id: '6', created_at: '2026-07-20T10:05:00.000Z', case_kind: 'risk' as const, expected_status: 'decided', expected_outcome: 'block' as const, expected_decision_id: 'low', assertion_passed: false },
    ]
    const result = ruleReleaseReadiness({
      ruleId: 'rule-1',
      ruleVersion: 2,
      ruleContract: contract,
      ruleSnapshotId: 'snapshot-v2',
      evaluatorRevision: RULE_CONTRACT_EVALUATOR_REVISION,
      runs: matrix,
    })

    expect(result).toMatchObject({ complete: false, requiredCount: 5, passedCount: 4 })
    expect(result.missingLabels).toContain('判定“低于底线”')
  })

  it('rejects evidence from another snapshot or evaluator revision', () => {
    const result = ruleReleaseReadiness({
      ruleId: 'rule-1',
      ruleVersion: 2,
      ruleContract: contract,
      ruleSnapshotId: 'snapshot-v2',
      ruleContractSha256: ruleContractSha256(contract),
      evaluatorRevision: RULE_CONTRACT_EVALUATOR_REVISION,
      runs: [{
        rule_id: 'rule-1',
        rule_version: 2,
        rule_snapshot_id: 'snapshot-v1',
        rule_contract_sha256: '0'.repeat(64),
        evaluator_revision: 'old-evaluator',
        created_at: '2026-07-20T10:00:00.000Z',
        case_kind: 'risk',
        expected_status: 'decided',
        expected_outcome: 'block',
        expected_decision_id: 'low',
        assertion_passed: true,
      }],
    })

    expect(result.passedCount).toBe(0)
  })

  it('requires snapshot and contract hash together when both bindings are known', () => {
    const result = ruleReleaseReadiness({
      ruleId: 'rule-1',
      ruleVersion: 2,
      ruleContract: contract,
      ruleSnapshotId: 'snapshot-v2',
      ruleContractSha256: ruleContractSha256(contract),
      evaluatorRevision: RULE_CONTRACT_EVALUATOR_REVISION,
      runs: [{
        rule_id: 'rule-1',
        rule_version: 2,
        rule_snapshot_id: 'snapshot-v2',
        rule_contract_sha256: '0'.repeat(64),
        evaluator_revision: RULE_CONTRACT_EVALUATOR_REVISION,
        case_kind: 'risk',
        expected_status: 'decided',
        expected_outcome: 'block',
        expected_decision_id: 'low',
        assertion_passed: true,
      }],
    })

    expect(result.passedCount).toBe(0)
  })

  it('does not require an impossible value-conflict case for a one-option enum', () => {
    const enumContract = {
      schema_version: '1.0' as const,
      properties: [{
        key: 'method',
        label: '付款方式',
        type: 'enum' as const,
        required: false,
        options: [{ value: 'prepaid', label: '预付款' }],
      }],
      decisions: [{
        id: 'prepaid',
        label: '预付款',
        outcome: 'pass' as const,
        priority: 100,
        match: 'all' as const,
        conditions: [{ property_key: 'method', operator: '=' as const, value: 'prepaid' }],
      }],
      missing_evidence_outcome: 'manual_review' as const,
    }

    expect(ruleReleaseRequirements(enumContract).map((item) => item.key)).toEqual([
      'decision:prepaid',
      'missing_evidence',
    ])
  })

  it('produces a stable canonical contract fingerprint independent of object key order', () => {
    expect(ruleContractSha256(contract)).toMatch(/^[0-9a-f]{64}$/)
    expect(ruleContractSha256({
      missing_evidence_outcome: contract.missing_evidence_outcome,
      decisions: contract.decisions,
      properties: contract.properties,
      schema_version: contract.schema_version,
    })).toBe(ruleContractSha256(contract))
  })
})
