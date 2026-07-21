import crypto from 'node:crypto'
import {
  normalizeRuleContract,
  ruleContractRequiresMissingEvidenceCase,
} from '@/lib/rules/rule-contract'
import type {
  ContractRuleContract,
  ContractRuleOutcome,
  ContractRuleTestCaseKind,
} from '@/types/rules'

export type RuleAcceptanceRun = {
  id?: string
  rule_id: string
  rule_version: number
  case_kind: ContractRuleTestCaseKind | 'legacy_unasserted'
  expected_status: string
  expected_outcome: ContractRuleOutcome
  expected_decision_id?: string | null
  assertion_passed: boolean
  rule_snapshot_id?: string | null
  rule_contract_sha256?: string | null
  evaluator_revision?: string | null
  created_at?: string
}

export type RuleReleaseRequirement = {
  key: string
  caseKind: ContractRuleTestCaseKind
  expectedStatus: 'decided' | 'missing_evidence'
  expectedDecisionId?: string
  expectedOutcome: ContractRuleOutcome
  label: string
}

export const RULE_CONTRACT_EVALUATOR_REVISION = 'rule-contract-v1-20260720'

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`
}

/**
 * Hash the exact persisted JSON contract after canonical key ordering.
 *
 * Do not normalize before calling this for snapshot/test evidence. Normalizing
 * intentionally removes empty optional fields, while the database release
 * transaction binds evidence to the exact JSON stored in the draft snapshot.
 */
export function ruleContractSha256(contract: unknown): string {
  return crypto.createHash('sha256').update(canonicalJson(contract)).digest('hex')
}

export function ruleReleaseRequirements(contract: ContractRuleContract): RuleReleaseRequirement[] {
  const requirements: RuleReleaseRequirement[] = contract.decisions.map((decision) => ({
    key: `decision:${decision.id}`,
    caseKind: (decision.outcome === 'pass' ? 'pass' : 'risk') as ContractRuleTestCaseKind,
    expectedStatus: 'decided',
    expectedDecisionId: decision.id,
    expectedOutcome: decision.outcome,
    label: `判定“${decision.label}”`,
  }))
  if (ruleContractRequiresMissingEvidenceCase(contract)) {
    requirements.push({
      key: 'missing_evidence',
      caseKind: 'missing_evidence',
      expectedStatus: 'missing_evidence',
      expectedOutcome: contract.missing_evidence_outcome,
      label: '缺少证据转人工',
    })
  }
  if (contract.properties.some((property) => (
    property.type !== 'text'
    && (property.type !== 'enum' || (property.options?.length || 0) >= 2)
  ))) {
    requirements.push({
      key: 'value_conflict',
      caseKind: 'value_conflict',
      expectedStatus: 'missing_evidence',
      expectedOutcome: contract.missing_evidence_outcome,
      label: '同文多值冲突转人工',
    })
  }
  if (contract.properties.some((property) => property.type === 'money' && property.currency)) {
    requirements.push({
      key: 'unit_conflict',
      caseKind: 'unit_conflict',
      expectedStatus: 'missing_evidence',
      expectedOutcome: contract.missing_evidence_outcome,
      label: '币种冲突转人工',
    })
  }
  return requirements
}

export function ruleReleaseReadiness(input: {
  ruleId: string
  ruleVersion: number
  ruleContract: unknown
  runs: RuleAcceptanceRun[]
  ruleSnapshotId?: string | null
  ruleContractSha256?: string | null
  evaluatorRevision?: string
}) {
  const contract = normalizeRuleContract(input.ruleContract)
  if (!contract) {
    return {
      complete: false,
      requiredCount: 0,
      passedCount: 0,
      missingLabels: ['规则详情尚未完成结构化配置'],
    }
  }
  const structuralMissingLabels = [
    ...(!contract.decisions.some((decision) => decision.outcome === 'pass')
      ? ['补充“其他情况通过”的正常结果']
      : []),
    ...(!contract.decisions.some((decision) => decision.outcome !== 'pass')
      ? ['至少配置一种风险结果']
      : []),
  ]
  if (structuralMissingLabels.length > 0) {
    return {
      complete: false,
      requiredCount: 0,
      passedCount: 0,
      missingLabels: structuralMissingLabels,
    }
  }
  const requirements = ruleReleaseRequirements(contract)
  const boundRuns = input.runs.filter((run) => (
    run.rule_id === input.ruleId
    && run.rule_version === input.ruleVersion
    && (!input.evaluatorRevision || run.evaluator_revision === input.evaluatorRevision)
    && (!input.ruleSnapshotId || run.rule_snapshot_id === input.ruleSnapshotId)
    && (!input.ruleContractSha256 || run.rule_contract_sha256 === input.ruleContractSha256)
  ))

  // A failed retry is evidence too: for one case/decision binding, only the
  // newest run is authoritative. Filtering passing rows first would let an old
  // success survive a later regression.
  const latestRuns = new Map<string, { run: RuleAcceptanceRun; index: number }>()
  boundRuns.forEach((run, index) => {
    const key = `${run.case_kind}:${run.expected_decision_id || ''}`
    const current = latestRuns.get(key)
    const candidateOrder = `${run.created_at || ''}:${run.id || ''}`
    const currentOrder = current
      ? `${current.run.created_at || ''}:${current.run.id || ''}`
      : ''
    if (!current || candidateOrder > currentOrder || (candidateOrder === currentOrder && index > current.index)) {
      latestRuns.set(key, { run, index })
    }
  })

  const runs = Array.from(latestRuns.values(), ({ run }) => run)
  const passed = requirements.filter((requirement) => runs.some((run) => (
    run.case_kind === requirement.caseKind
    && run.assertion_passed
    && run.expected_status === requirement.expectedStatus
    && run.expected_outcome === requirement.expectedOutcome
    && (requirement.expectedDecisionId
      ? run.expected_decision_id === requirement.expectedDecisionId
      : true)
  )))
  const passedKeys = new Set(passed.map((requirement) => requirement.key))
  return {
    complete: passed.length === requirements.length,
    requiredCount: requirements.length,
    passedCount: passed.length,
    missingLabels: requirements
      .filter((requirement) => !passedKeys.has(requirement.key))
      .map((requirement) => requirement.label),
  }
}
