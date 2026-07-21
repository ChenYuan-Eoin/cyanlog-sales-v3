import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import {
  buildRuleUnits,
  summarizeRuleTranslationGate,
} from '@/lib/contracts/rule-unit'
import { normalizeRuleContract } from '@/lib/rules/rule-contract'
import {
  RULE_CONTRACT_EVALUATOR_REVISION,
  ruleContractSha256,
  ruleReleaseReadiness,
  type RuleAcceptanceRun,
} from '@/lib/rules/rule-release-readiness'
import type { ContractRuleContract } from '@/types/rules'

type JsonRecord = Record<string, unknown>

const SKILL_BUNDLE_KEY = 'CONTRACT_REVIEW_DEFAULT'
const CONFIG_CENTER_RULE_SOURCE = {
  owner: 'F009',
  source_of_truth: 'config_center_published_rules',
  rules_table: 'contract_rules_v2',
  snapshot_table: 'contract_rule_snapshots',
  release_boundary: 'published_rule_snapshots_only',
  precedence: 'production_source_of_truth',
}
const ONES_CONTRACT_REFERENCE_ASSET = {
  repo: 'suoyidev/ones-internal-skills',
  url: 'https://github.com/suoyidev/ones-internal-skills',
  commit: 'f8b0c27f5c19a499c1563923ca372a2171aaca58',
  skill: 'ones-contract-assistant',
  version: '2.2.2',
  last_updated: '2026-06-16',
  usage: 'reference_import_template_and_eval_cases_only',
  product_override: 'ONES Sales 第一阶段采用批注为主、报告为辅；该仓库不能覆盖配置中心发布规则，只能作为导入参考、模板和评测样例。',
}

const ONES_SKILL_REFERENCES = [
  'references/01-条款红黄绿标准.md',
  'references/02-让步梯度与对价.md',
  'references/03-标准话术库.md',
  'references/04-实战口径.md',
  'references/05-审批流转指引.md',
  'references/06-税率自检清单.md',
  'references/07-业务实操清单.md',
  'references/08-多版本对比标准.md',
  'references/09-二次验证清单.md',
  'references/10-产品名称标准清单.md',
  'references/11-逻辑审查清单.md',
  'references/12-报告样式标准.md',
  'references/13-结构化输出schema.md',
  'references/14-品类分流.md',
]

const ONES_SKILL_EVAL_CASES = [
  'eval1_private_deploy_redline',
  'eval2_tax_mixed_contract',
  'eval3_amount_consistency',
  'eval4_domestic_hospital_no_dpa_negative',
  'eval5_standard_template_no_fabricated_risks_negative',
  'eval6_product_name_v7',
  'eval7_dispute_resolution_foreign_arbitration',
  'eval8_sla_compensation_and_7x24',
  'eval9_version_compare',
  'eval10_confidentiality_8_years',
  'eval11_ip_ownership_redline',
  'eval12_cross_border_data',
  'eval13_add_on_order',
  'eval14_amount_uppercase',
]

type RuleRow = {
  id: string
  rule_set_id: string | null
  problem_category_id: string | null
  code: string
  name: string
  business_domain: string | null
  risk_level: string | null
  applicable_scenarios: string[] | null
  scope: string | null
  lifecycle_status: string | null
  translation_status: string | null
  version: number | null
  engine_type: string | null
  target_field: string | null
  clause_category: string | null
  field_hints: string[] | null
  semantic_prompt: string | null
  message_template: unknown
  rule_contract: ContractRuleContract | null
  priority: number | null
  updated_at: string | null
  published_at: string | null
}

export type RuleSnapshotRow = {
  id: string
  rule_id: string
  version: number | null
  status: string | null
  released_at: string | null
  created_at: string | null
  config_snapshot: unknown
}

type RuleSetRow = {
  id: string
  code: string
  name: string
  description: string | null
  version: number | null
  lifecycle_status: string | null
  translation_status: string | null
  published_at: string | null
}

type RuleSetPointerRow = {
  id: string
  org_id: string
  current_snapshot_id: string | null
  published_at: string | null
  lifecycle_status: string | null
  translation_status: string | null
}

type RuleSetDocumentRow = {
  id: string
  org_id: string
  rule_set_id: string
  title: string
  source_type: string
  source_uri: string | null
  content_hash: string
  version: number | null
  status: string | null
  translation_status: string | null
  updated_at: string | null
}

export type RuleSetSnapshotRow = {
  id: string
  org_id: string
  rule_set_id: string
  version: number | null
  status: string | null
  rule_snapshot_ids: string[] | null
  document_snapshot_ids: string[] | null
  config_snapshot: unknown
  test_results: unknown
  released_at: string | null
}

type SkillBundleRow = Omit<ContractSkillBundle, 'compiled_from' | 'output_schema'> & {
  compiled_from: unknown
  output_schema: unknown
}

type BundleEvalStatus = 'passed' | 'runtime_eval_not_run' | 'failed'

export type PublishedRuleEvalSummary = {
  status: BundleEvalStatus
  total_rules: number
  passed_rules: number
  required_cases: number
  passed_cases: number
  blocking_reasons: string[]
}

type RuleSetDocumentGate = {
  status: 'ready' | 'failed'
  total_rule_sets: number
  ready_documents: number
  blocking_reasons: string[]
}

type RuleSetSnapshotGate = {
  status: 'ready' | 'failed'
  total_rule_sets: number
  published_snapshots: number
  blocking_reasons: string[]
}

type FormalReviewBundleGateInput = {
  status?: string | null
  is_current?: boolean | null
  published_at?: string | null
  release_meta?: unknown
  compiled_from?: unknown
}

export type ContractSkillBundle = {
  id: string
  org_id: string
  key: string
  version: number
  status: 'draft' | 'compiled' | 'published' | 'archived'
  is_current: boolean
  rule_snapshot_ids: string[]
  rule_set_snapshot_ids: string[]
  template_snapshot_ids: string[]
  document_snapshot_ids: string[]
  output_schema: JsonRecord
  /** Legacy read-only pointer. WP02 freezes AIExecutionPlan separately. */
  model_policy_id: string | null
  eval_case_ids: string[]
  release_meta: JsonRecord
  compiled_from: JsonRecord
  compiled_hash: string
  published_at: string | null
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function normalizeAcceptanceRuns(value: unknown, frozenOwner: {
  ruleId: string
  ruleVersion: number
}): RuleAcceptanceRun[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((candidate) => {
    const run = asRecord(candidate)
    const ruleId = stringValue(run.rule_id) || frozenOwner.ruleId
    const ruleVersion = typeof run.rule_version === 'number'
      ? run.rule_version
      : frozenOwner.ruleVersion
    const outcome = stringValue(run.expected_outcome)
    const caseKind = stringValue(run.case_kind)
    if (
      !caseKind
      || !['risk', 'pass', 'missing_evidence', 'value_conflict', 'unit_conflict', 'legacy_unasserted'].includes(caseKind)
      || !stringValue(run.expected_status)
      || !outcome
      || !['pass', 'negotiate', 'block', 'manual_review'].includes(outcome)
      || typeof run.assertion_passed !== 'boolean'
    ) return []
    return [{
      id: stringValue(run.id) || undefined,
      rule_id: ruleId,
      rule_version: ruleVersion,
      case_kind: caseKind as RuleAcceptanceRun['case_kind'],
      expected_status: stringValue(run.expected_status) as string,
      expected_outcome: outcome as RuleAcceptanceRun['expected_outcome'],
      expected_decision_id: stringValue(run.expected_decision_id),
      assertion_passed: run.assertion_passed,
      rule_snapshot_id: stringValue(run.rule_snapshot_id),
      rule_contract_sha256: stringValue(run.rule_contract_sha256),
      evaluator_revision: stringValue(run.evaluator_revision),
      created_at: stringValue(run.created_at) || undefined,
    }]
  })
}

/**
 * Evaluate only acceptance evidence frozen into the exact current RuleSet and
 * Rule snapshots. Translation readiness and external reference cases are not
 * executable proof and can never produce a passed status by themselves.
 */
export function summarizePublishedRuleEval(input: {
  ruleTranslationStatus: string
  ruleSetSnapshots: RuleSetSnapshotRow[]
  ruleSnapshots: RuleSnapshotRow[]
}): PublishedRuleEvalSummary {
  const { ruleTranslationStatus, ruleSetSnapshots, ruleSnapshots } = input
  const blockingReasons: string[] = []
  let passedRules = 0
  let requiredCases = 0
  let passedCases = 0
  let hasAnyEvidence = false

  if (ruleTranslationStatus !== 'ready') {
    blockingReasons.push('rule_translation_not_ready')
  }
  if (ruleSnapshots.length === 0) {
    blockingReasons.push('no_published_rule_snapshots')
  }

  const setSnapshotByRuleSnapshotId = new Map<string, RuleSetSnapshotRow>()
  for (const setSnapshot of ruleSetSnapshots) {
    const testResults = asRecord(setSnapshot.test_results)
    if (stringValue(testResults.gate) !== 'snapshot_bound_latest_asserted_rule_matrix') {
      blockingReasons.push(`ruleset_acceptance_gate_missing:${setSnapshot.id}`)
    }
    if (Number(testResults.rule_count) !== (setSnapshot.rule_snapshot_ids || []).length) {
      blockingReasons.push(`ruleset_acceptance_count_mismatch:${setSnapshot.id}`)
    }
    for (const ruleSnapshotId of setSnapshot.rule_snapshot_ids || []) {
      setSnapshotByRuleSnapshotId.set(ruleSnapshotId, setSnapshot)
    }
  }

  for (const snapshot of ruleSnapshots) {
    const config = asRecord(snapshot.config_snapshot)
    const releaseEvidence = asRecord(config._release_evidence)
    const contract = normalizeRuleContract(config.rule_contract)
    if (!contract || contract.properties.length === 0 || contract.decisions.length === 0) {
      blockingReasons.push(`canonical_rule_contract_missing:${snapshot.id}`)
      continue
    }
    const setSnapshot = setSnapshotByRuleSnapshotId.get(snapshot.id)
    if (!setSnapshot) {
      blockingReasons.push(`ruleset_acceptance_snapshot_missing:${snapshot.id}`)
      continue
    }
    const ruleRuns = asRecord(asRecord(setSnapshot.test_results).rule_runs)
    const runs = normalizeAcceptanceRuns(ruleRuns[snapshot.rule_id], {
      ruleId: snapshot.rule_id,
      ruleVersion: snapshot.version || 0,
    })
    if (runs.length > 0) hasAnyEvidence = true
    const readiness = ruleReleaseReadiness({
      ruleId: snapshot.rule_id,
      ruleVersion: snapshot.version || 0,
      ruleContract: contract,
      runs,
      // Acceptance is bound to the exact draft that passed the matrix. The
      // release transaction then creates a distinct published snapshot and
      // records that draft id in immutable release evidence.
      ruleSnapshotId: stringValue(releaseEvidence.accepted_draft_snapshot_id) || snapshot.id,
      ruleContractSha256: ruleContractSha256(contract),
      evaluatorRevision: RULE_CONTRACT_EVALUATOR_REVISION,
    })
    requiredCases += readiness.requiredCount
    passedCases += readiness.passedCount
    if (readiness.complete) {
      passedRules += 1
    } else {
      blockingReasons.push(...readiness.missingLabels.map((label) => (
        `rule_acceptance_missing:${snapshot.id}:${label}`
      )))
    }
  }

  const passed = ruleTranslationStatus === 'ready'
    && ruleSnapshots.length > 0
    && passedRules === ruleSnapshots.length
    && blockingReasons.length === 0
  return {
    status: passed ? 'passed' : hasAnyEvidence ? 'failed' : 'runtime_eval_not_run',
    total_rules: ruleSnapshots.length,
    passed_rules: passedRules,
    required_cases: requiredCases,
    passed_cases: passedCases,
    blocking_reasons: Array.from(new Set(blockingReasons)),
  }
}

export type PublishedRuleSnapshotValidationReason =
  | 'snapshot_missing'
  | 'status_not_published'
  | 'org_id_mismatch'
  | 'rule_id_mismatch'
  | 'rule_set_id_mismatch'
  | 'version_mismatch'
  | 'inactive'
  | 'problem_category_missing'
  | 'rule_contract_invalid'

/**
 * Validate the immutable business meaning carried by a published RuleSnapshot.
 * A live Rule row or the legacy A/B/C columns cannot repair an incomplete
 * snapshot at runtime because that would make an old ReviewRun drift.
 */
export function validatePublishedRuleSnapshot(input: {
  snapshot: RuleSnapshotRow | null
  orgId: string
  ownerRuleSetId: string | undefined
}): PublishedRuleSnapshotValidationReason[] {
  const { snapshot, orgId, ownerRuleSetId } = input
  if (!snapshot) return ['snapshot_missing']

  const config = asRecord(snapshot.config_snapshot)
  const canonical = normalizeRuleContract(config.rule_contract)
  const reasons: PublishedRuleSnapshotValidationReason[] = []
  if (snapshot.status !== 'published') reasons.push('status_not_published')
  if (stringValue(config.org_id) !== orgId) reasons.push('org_id_mismatch')
  if (stringValue(config.id) !== snapshot.rule_id) reasons.push('rule_id_mismatch')
  if (stringValue(config.rule_set_id) !== ownerRuleSetId) reasons.push('rule_set_id_mismatch')
  if (Number(config.version) !== snapshot.version) reasons.push('version_mismatch')
  if (config.is_active !== true) reasons.push('inactive')
  if (!stringValue(config.problem_category_id)) reasons.push('problem_category_missing')
  if (!canonical || canonical.properties.length === 0 || canonical.decisions.length === 0) {
    reasons.push('rule_contract_invalid')
  }
  return reasons
}

export function isContractSkillBundleFormalReviewAllowed(bundle: FormalReviewBundleGateInput): boolean {
  const releaseMeta = asRecord(bundle.release_meta)
  const compiledFrom = asRecord(bundle.compiled_from)
  const ruleTranslationGate = asRecord(compiledFrom.rule_translation_gate)
  const ruleSetSnapshotGate = asRecord(compiledFrom.rule_set_snapshot_gate)
  const ruleSetDocumentGate = asRecord(compiledFrom.rule_set_document_gate)
  const evalResults = asRecord(compiledFrom.eval_results)

  return bundle.status === 'published'
    && bundle.is_current === true
    && Boolean(bundle.published_at)
    && booleanValue(releaseMeta.official_review_allowed) === true
    && stringValue(ruleTranslationGate.status) === 'ready'
    && booleanValue(ruleTranslationGate.official_review_allowed) === true
    && stringValue(ruleSetSnapshotGate.status) === 'ready'
    && stringValue(ruleSetDocumentGate.status) === 'ready'
    && stringValue(evalResults.rule_acceptance_status) === 'passed'
}

function normalizeBundle(row: SkillBundleRow): ContractSkillBundle {
  return {
    ...row,
    rule_snapshot_ids: Array.isArray(row.rule_snapshot_ids) ? row.rule_snapshot_ids : [],
    rule_set_snapshot_ids: Array.isArray(row.rule_set_snapshot_ids) ? row.rule_set_snapshot_ids : [],
    template_snapshot_ids: Array.isArray(row.template_snapshot_ids) ? row.template_snapshot_ids : [],
    document_snapshot_ids: Array.isArray(row.document_snapshot_ids) ? row.document_snapshot_ids : [],
    eval_case_ids: Array.isArray(row.eval_case_ids) ? row.eval_case_ids : [],
    output_schema: asRecord(row.output_schema),
    release_meta: asRecord(row.release_meta),
    compiled_from: asRecord(row.compiled_from),
  }
}

function stableHash(value: unknown) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex')
}

export function hashContractSkillBundleContent(input: {
  rule_snapshot_ids: string[]
  rule_set_snapshot_ids: string[]
  template_snapshot_ids: string[]
  document_snapshot_ids: string[]
  output_schema: JsonRecord
  model_policy_id: string | null
  eval_case_ids: string[]
  compiled_from: JsonRecord
}) {
  return stableHash(input)
}

function outputSchema(): JsonRecord {
  return {
    schema_version: 'f006.review.v1',
    required_outputs: [
      'risk_findings',
      'negotiation_tasks',
      'review_evidence',
      'comment_patch_drafts',
      'report_summary',
    ],
    review_run_binding: {
      required: [
        'contract_version_id',
        'skill_bundle_id',
        'rule_snapshot_ids',
        'rule_set_snapshot_ids',
        'rule_set_document_ids',
        'plan_snapshot_id',
        'plan_snapshot_hash',
        'model_invocation_ids',
      ],
      legacy_optional: ['model_policy_id'],
      immutable_after_start: true,
    },
    risk_finding: {
      required: ['level', 'status', 'title', 'description', 'suggestion', 'evidence', 'source_trace'],
      levels: ['red', 'yellow', 'green', 'white'],
      statuses: [
        'detected',
        'needs_owner_review',
        'needs_negotiation',
        'resolved',
        'waived',
        'escalated',
      ],
      evidence: ['snippets', 'start_offset', 'end_offset', 'clause_ref', 'template_reference'],
      source_trace: ['rule_snapshot_id', 'rule_code', 'rule_version', 'model_invocation_id'],
    },
    negotiation_task: {
      required: ['risk_finding_id', 'required', 'owner_role', 'objective', 'standard'],
      required_when: 'risk_finding.level in red,yellow or rule.requires_negotiation',
      output: 'sales_negotiation_task',
    },
    comment_patch_draft: {
      required: ['risk_finding_id', 'selected_text', 'comment', 'priority', 'author'],
      output: 'word_native_comment',
      author: 'ONES 业务运营',
      fallback_when_position_missing: 'manual_location_required_or_report_only',
    },
    report_summary: {
      role: 'auxiliary',
      must_use_same_fact_set_as_comments: true,
    },
    validation: {
      on_schema_error: 'retry_then_rule_fallback_or_human_review',
      forbid_unversioned_prompt_result: true,
      second_verification_reference: 'references/09-二次验证清单.md',
      required_checks: [
        'risk_location_matches_source_text',
        'original_summary_is_faithful',
        'numbers_and_dates_are_not_hallucinated',
        'risk_description_matches_rule',
        'suggestion_is_actionable_for_sales_negotiation',
        'no_unreferenced_extrapolation',
      ],
    },
  }
}

function findSnapshotForRule(rule: RuleRow, snapshots: RuleSnapshotRow[]) {
  const candidates = snapshots.filter((snapshot) => snapshot.rule_id === rule.id)
  if (candidates.length === 0) return null

  const ruleVersion = rule.version ?? null
  if (ruleVersion !== null) {
    const exact = candidates.find((snapshot) => (snapshot.version ?? null) === ruleVersion)
    if (exact) return exact
  }

  return candidates[0]
}

async function loadRulesFromRuleSetSnapshots(orgId: string, ruleSetSnapshots: RuleSetSnapshotRow[]) {
  const ownerByRuleSnapshotId = new Map<string, string>()
  for (const ruleSetSnapshot of ruleSetSnapshots) {
    for (const ruleSnapshotId of ruleSetSnapshot.rule_snapshot_ids || []) {
      const previousOwner = ownerByRuleSnapshotId.get(ruleSnapshotId)
      if (previousOwner && previousOwner !== ruleSetSnapshot.rule_set_id) {
        throw new Error(`RULESET_CURRENT_RULE_SNAPSHOT_OWNER_CONFLICT:${ruleSnapshotId}`)
      }
      ownerByRuleSnapshotId.set(ruleSnapshotId, ruleSetSnapshot.rule_set_id)
    }
  }
  const snapshotIds = Array.from(new Set(
    ruleSetSnapshots.flatMap((snapshot) => snapshot.rule_snapshot_ids || []).filter(Boolean)
  ))
  if (snapshotIds.length === 0) {
    if (ruleSetSnapshots.length > 0) {
      throw new Error('RULESET_CURRENT_MEMBERSHIP_EMPTY')
    }
    return { rules: [] as RuleRow[], snapshots: [] as RuleSnapshotRow[] }
  }

  const { data, error } = await supabaseAdmin
    .from('contract_rule_snapshots')
    .select('id, rule_id, version, status, released_at, created_at, config_snapshot')
    .in('id', snapshotIds)

  if (error) throw error
  const returnedSnapshots = (data || []) as RuleSnapshotRow[]
  const snapshotsById = new Map(returnedSnapshots.map((snapshot) => [snapshot.id, snapshot]))
  const validationIssues = snapshotIds.flatMap((snapshotId) => {
    const reasons = validatePublishedRuleSnapshot({
      snapshot: snapshotsById.get(snapshotId) || null,
      orgId,
      ownerRuleSetId: ownerByRuleSnapshotId.get(snapshotId),
    })
    return reasons.length > 0 ? [`${snapshotId}[${reasons.join('|')}]`] : []
  })
  if (validationIssues.length > 0) {
    throw new Error(`RULESET_CURRENT_RULE_SNAPSHOT_INVALID:${validationIssues.join(',')}`)
  }
  const snapshots = snapshotIds.map((snapshotId) => snapshotsById.get(snapshotId) as RuleSnapshotRow)
  const snapshotByRuleId = new Map<string, string>()
  for (const snapshot of snapshots) {
    const previousSnapshotId = snapshotByRuleId.get(snapshot.rule_id)
    if (previousSnapshotId && previousSnapshotId !== snapshot.id) {
      throw new Error(`RULESET_CURRENT_RULE_VERSION_CONFLICT:${snapshot.rule_id}`)
    }
    snapshotByRuleId.set(snapshot.rule_id, snapshot.id)
  }
  const rules = snapshots.map((snapshot) => ({
    ...asRecord(snapshot.config_snapshot),
    id: snapshot.rule_id,
    version: snapshot.version,
    lifecycle_status: 'published',
    translation_status: 'ready',
    published_at: snapshot.released_at,
  } as RuleRow)).sort((left, right) => left.code.localeCompare(right.code))
  return { rules, snapshots }
}

export async function loadFrozenRuleSetDocuments(orgId: string, snapshots: RuleSetSnapshotRow[]) {
  const ownerByDocumentId = new Map<string, string>()
  for (const snapshot of snapshots) {
    for (const documentId of snapshot.document_snapshot_ids || []) {
      if (!documentId) continue
      const previousOwner = ownerByDocumentId.get(documentId)
      if (previousOwner && previousOwner !== snapshot.rule_set_id) {
        throw new Error(`RULESET_CURRENT_DOCUMENT_OWNER_CONFLICT:${documentId}`)
      }
      ownerByDocumentId.set(documentId, snapshot.rule_set_id)
    }
  }

  const documentIds = Array.from(ownerByDocumentId.keys())
  if (documentIds.length === 0) return [] as RuleSetDocumentRow[]
  const documentResult = await supabaseAdmin
    .from('contract_rule_set_documents')
    .select('id, org_id, rule_set_id, title, source_type, source_uri, content_hash, version, status, translation_status, updated_at')
    .eq('org_id', orgId)
    .in('id', documentIds)
  if (documentResult.error) throw documentResult.error

  const returnedDocuments = (documentResult.data || []) as RuleSetDocumentRow[]
  const documentsById = new Map<string, RuleSetDocumentRow>()
  const duplicateDocumentIds = new Set<string>()
  for (const document of returnedDocuments) {
    if (documentsById.has(document.id)) duplicateDocumentIds.add(document.id)
    documentsById.set(document.id, document)
  }

  const validationIssues = documentIds.flatMap((documentId) => {
    if (duplicateDocumentIds.has(documentId)) return [`${documentId}[duplicate]`]
    const document = documentsById.get(documentId)
    if (!document) return [`${documentId}[missing]`]
    const reasons = [
      document.org_id !== orgId ? 'org_mismatch' : null,
      document.rule_set_id !== ownerByDocumentId.get(documentId) ? 'rule_set_mismatch' : null,
      document.status !== 'published' ? 'status_not_published' : null,
      document.translation_status !== 'ready' ? 'translation_not_ready' : null,
    ].filter((reason): reason is string => Boolean(reason))
    return reasons.length > 0 ? [`${documentId}[${reasons.join('|')}]`] : []
  })
  if (validationIssues.length > 0) {
    throw new Error(`RULESET_CURRENT_DOCUMENT_INVALID:${validationIssues.join(',')}`)
  }

  return documentIds
    .map((documentId) => documentsById.get(documentId) as RuleSetDocumentRow)
    .sort((left, right) => left.id.localeCompare(right.id))
}

export function summarizeRuleSetDocumentGate(ruleSets: RuleSetRow[], documents: RuleSetDocumentRow[]): RuleSetDocumentGate {
  return {
    // RuleSetDocument is optional reference material. An omitted reference does
    // not block release; once a snapshot names one, loadFrozenRuleSetDocuments
    // validates that exact frozen identity and fails closed before compilation.
    status: ruleSets.length > 0 ? 'ready' : 'failed',
    total_rule_sets: ruleSets.length,
    ready_documents: documents.length,
    blocking_reasons: ruleSets.length > 0 ? [] : ['no_published_rule_sets'],
  }
}

export async function loadPublishedRuleSetSnapshots(orgId: string, ruleSetIds: string[] = []) {
  const uniqueIds = Array.from(new Set(ruleSetIds.filter(Boolean)))
  let pointerQuery = supabaseAdmin
    .from('contract_rule_sets')
    .select('id, org_id, current_snapshot_id, published_at, lifecycle_status, translation_status')
    .eq('org_id', orgId)
    .eq('is_active', true)
  if (uniqueIds.length > 0) pointerQuery = pointerQuery.in('id', uniqueIds)

  const { data: pointerData, error: pointerError } = await pointerQuery
  if (pointerError) throw pointerError

  // Live lifecycle fields describe the mutable control plane. Saving a draft
  // may set ready_to_publish while current_snapshot_id must keep serving the
  // previous immutable release until the atomic publish moves the pointer.
  const activeRuleSets = ((pointerData || []) as RuleSetPointerRow[])
    .sort((left, right) => left.id.localeCompare(right.id))
  const foreignPointers = activeRuleSets.filter((pointer) => pointer.org_id !== orgId)
  if (foreignPointers.length > 0) {
    throw new Error(`RULESET_CURRENT_POINTER_ORG_MISMATCH:${foreignPointers.map((pointer) => pointer.id).join(',')}`)
  }
  const inconsistentPointers = activeRuleSets.filter((pointer) => (
    Boolean(pointer.current_snapshot_id) !== Boolean(pointer.published_at)
  ))
  if (inconsistentPointers.length > 0) {
    throw new Error(`RULESET_CURRENT_POINTER_STATE_INVALID:${inconsistentPointers.map((pointer) => pointer.id).join(',')}`)
  }
  const pointers = activeRuleSets.filter((pointer) => (
    Boolean(pointer.current_snapshot_id) && Boolean(pointer.published_at)
  ))
  if (pointers.length === 0) return [] as RuleSetSnapshotRow[]

  const currentSnapshotIds = pointers.map((pointer) => pointer.current_snapshot_id as string)
  const { data, error } = await supabaseAdmin
    .from('contract_rule_set_snapshots')
    .select('id, org_id, rule_set_id, version, status, rule_snapshot_ids, document_snapshot_ids, config_snapshot, test_results, released_at')
    .in('id', currentSnapshotIds)
    .eq('org_id', orgId)
    .eq('status', 'published')

  if (error) throw error
  const snapshots = (data || []) as RuleSetSnapshotRow[]
  const snapshotsById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]))
  const invalidPointers = pointers.filter((pointer) => {
    const snapshot = snapshotsById.get(pointer.current_snapshot_id as string)
    return !snapshot
      || snapshot.org_id !== orgId
      || snapshot.rule_set_id !== pointer.id
      || snapshot.status !== 'published'
  })
  if (invalidPointers.length > 0) {
    throw new Error(`RULESET_CURRENT_SNAPSHOT_INVALID:${invalidPointers.map((pointer) => pointer.id).join(',')}`)
  }

  for (const pointer of pointers) {
    const snapshot = snapshotsById.get(pointer.current_snapshot_id as string) as RuleSetSnapshotRow
    const memberIds = snapshot.rule_snapshot_ids
    if (
      !Array.isArray(memberIds)
      || memberIds.length === 0
      || memberIds.some((memberId) => typeof memberId !== 'string' || memberId.trim().length === 0)
      || new Set(memberIds).size !== memberIds.length
    ) {
      throw new Error(`RULESET_CURRENT_MEMBERSHIP_INVALID:${pointer.id}`)
    }
  }

  return pointers.map((pointer) => snapshotsById.get(pointer.current_snapshot_id as string) as RuleSetSnapshotRow)
}

function summarizeRuleSetSnapshotGate(
  ruleSetIds: string[],
  snapshots: RuleSetSnapshotRow[],
  ruleSnapshotIdsBySetId: Map<string, string[]>
): RuleSetSnapshotGate {
  const snapshotsBySetId = new Map(snapshots.map((snapshot) => [snapshot.rule_set_id, snapshot]))
  const missing = ruleSetIds.filter((id) => !snapshotsBySetId.has(id))
  const mismatched = ruleSetIds.filter((id) => {
    const snapshot = snapshotsBySetId.get(id)
    if (!snapshot) return false
    const expected = new Set(ruleSnapshotIdsBySetId.get(id) || [])
    const actual = new Set(snapshot.rule_snapshot_ids || [])
    return expected.size !== actual.size || Array.from(expected).some((value) => !actual.has(value))
  })
  const blockingReasons = [
    ...missing.map((id) => `published_rule_set_snapshot_missing:${id}`),
    ...mismatched.map((id) => `rule_set_snapshot_membership_mismatch:${id}`),
  ]
  return {
    status: blockingReasons.length === 0 && ruleSetIds.length > 0 ? 'ready' : 'failed',
    total_rule_sets: ruleSetIds.length,
    published_snapshots: snapshots.length,
    blocking_reasons: blockingReasons.length > 0 ? blockingReasons : ruleSetIds.length > 0 ? [] : ['no_published_rule_sets'],
  }
}

async function fetchCurrentBundle(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('contract_skill_bundles')
    .select('*')
    .eq('org_id', orgId)
    .eq('key', SKILL_BUNDLE_KEY)
    .eq('status', 'published')
    .eq('is_current', true)
    .eq('compiled_identity_generation', 1)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  const bundle = normalizeBundle(data as SkillBundleRow)
  return isContractSkillBundleFormalReviewAllowed(bundle) ? bundle : null
}

async function fetchReusableBundle(
  orgId: string,
  compiledHash: string,
  status: ContractSkillBundle['status']
) {
  const { data, error } = await supabaseAdmin
    .from('contract_skill_bundles')
    .select('*')
    .eq('org_id', orgId)
    .eq('key', SKILL_BUNDLE_KEY)
    .eq('compiled_hash', compiledHash)
    .eq('status', status)
    .eq('compiled_identity_generation', 1)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data ? normalizeBundle(data as SkillBundleRow) : null
}

export async function persistContractSkillBundle(input: {
  orgId: string
  status: 'compiled' | 'published'
  compiledHash: string
  payload: JsonRecord
  requestedBy?: string | null
}): Promise<ContractSkillBundle> {
  const { data, error } = await supabaseAdmin.rpc('persist_contract_skill_bundle_v1', {
    p_org_id: input.orgId,
    p_key: SKILL_BUNDLE_KEY,
    p_status: input.status,
    p_compiled_hash: input.compiledHash,
    p_payload: input.payload,
    p_requested_by: input.requestedBy || null,
  })
  if (error) throw error
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('SKILL_BUNDLE_PERSIST_RESULT_MISSING')
  }

  const bundle = normalizeBundle(data as unknown as SkillBundleRow)
  const identityValid = bundle.org_id === input.orgId
    && bundle.key === SKILL_BUNDLE_KEY
    && bundle.status === input.status
    && bundle.compiled_hash === input.compiledHash
  const lifecycleValid = input.status === 'published'
    ? isContractSkillBundleFormalReviewAllowed(bundle)
    : bundle.is_current === false && bundle.published_at === null
  if (!identityValid || !lifecycleValid) {
    throw new Error('SKILL_BUNDLE_PERSIST_RESULT_INVALID')
  }
  return bundle
}

export async function getOrCompilePublishedContractSkillBundle(input: {
  orgId: string
  requestedBy?: string | null
}): Promise<ContractSkillBundle> {
  const { orgId, requestedBy } = input
  const ruleSetSnapshots = await loadPublishedRuleSetSnapshots(orgId)
  const { rules, snapshots } = await loadRulesFromRuleSetSnapshots(orgId, ruleSetSnapshots)
  const snapshotsByRuleId = new Map(
    rules
      .map((rule) => [rule.id, findSnapshotForRule(rule, snapshots)] as const)
      .filter((entry): entry is readonly [string, RuleSnapshotRow] => Boolean(entry[1]))
  )
  const ruleUnits = buildRuleUnits(rules, snapshotsByRuleId)
  const ruleTranslationGate = summarizeRuleTranslationGate(ruleUnits)
  const rulesById = new Map(rules.map((rule) => [rule.id, rule]))
  const ruleSetIds = ruleSetSnapshots.map((snapshot) => snapshot.rule_set_id)
  const ruleSetDocuments = await loadFrozenRuleSetDocuments(orgId, ruleSetSnapshots)
  const snapshotRefs = ruleUnits
    .filter((unit) => unit.source_trace.snapshot_id)
    .map((unit) => ({
      id: unit.id,
      rule_id: unit.rule_id,
      rule_set_id: rulesById.get(unit.rule_id)?.rule_set_id || null,
      problem_category_id: rulesById.get(unit.rule_id)?.problem_category_id || null,
      code: unit.code,
      version: unit.version,
      business_domain: unit.business_domain,
      risk_level: unit.risk_level,
      applicable_scenarios: unit.applicable_scenarios,
      scope: unit.scope,
      execution_protocol: unit.rule_contract ? 'rule_contract_v1' : 'legacy_adapter',
      rule_contract: unit.rule_contract,
      engine_type: unit.engine_type,
      target_field: unit.target_field,
      clause_category: unit.clause_category,
      field_hints: unit.field_hints,
      translation_status: unit.translation.status,
    }))

  const schema = outputSchema()
  const evalSummary = summarizePublishedRuleEval({
    ruleTranslationStatus: ruleTranslationGate.status,
    ruleSetSnapshots,
    ruleSnapshots: snapshots,
  })
  const evalStatus = evalSummary.status
  const ruleSnapshotIdsBySetId = new Map<string, string[]>()
  for (const ref of snapshotRefs) {
    if (!ref.rule_set_id) continue
    const existing = ruleSnapshotIdsBySetId.get(ref.rule_set_id) || []
    existing.push(ref.id)
    ruleSnapshotIdsBySetId.set(ref.rule_set_id, existing)
  }
  const ruleSetSnapshotGate = summarizeRuleSetSnapshotGate(
    ruleSetIds,
    ruleSetSnapshots,
    ruleSnapshotIdsBySetId
  )
  const publishedRuleSetAssets = ruleSetSnapshots.map((snapshot) => {
    const config = asRecord(snapshot.config_snapshot)
    return {
      id: snapshot.rule_set_id,
      code: stringValue(config.code) || snapshot.rule_set_id,
      name: stringValue(config.name) || snapshot.rule_set_id,
      description: stringValue(config.description) || null,
      version: snapshot.version,
      lifecycle_status: 'published',
      translation_status: 'ready',
      published_at: snapshot.released_at,
    } satisfies RuleSetRow
  })
  const ruleSetDocumentGate = summarizeRuleSetDocumentGate(publishedRuleSetAssets, ruleSetDocuments)
  const formalReviewAllowed = ruleTranslationGate.official_review_allowed
    && ruleSetSnapshotGate.status === 'ready'
    && ruleSetDocumentGate.status === 'ready'
    && evalStatus === 'passed'
  const bundleStatus: ContractSkillBundle['status'] = formalReviewAllowed ? 'published' : 'compiled'
  const ruleSetSnapshotIds = ruleSetSnapshots.map((snapshot) => snapshot.id)
  const documentSnapshotIds = Array.from(new Set(
    ruleSetSnapshots.flatMap((snapshot) => snapshot.document_snapshot_ids || []).filter(Boolean)
  ))

  const compiledFrom = {
    product_phase: 'contract_review_first_stage',
    skill_key: SKILL_BUNDLE_KEY,
    production_rule_source: CONFIG_CENTER_RULE_SOURCE,
    reference_assets: ONES_SKILL_REFERENCES.map((reference) => ({
      kind: 'github_skill_reference',
      repo: ONES_CONTRACT_REFERENCE_ASSET.repo,
      url: ONES_CONTRACT_REFERENCE_ASSET.url,
      path: reference,
      source: `${ONES_CONTRACT_REFERENCE_ASSET.repo}/${reference}`,
      commit: ONES_CONTRACT_REFERENCE_ASSET.commit,
      usage: ONES_CONTRACT_REFERENCE_ASSET.usage,
    })),
    output_schema_reference: 'references/13-结构化输出schema.md',
    second_verification_reference: 'references/09-二次验证清单.md',
    second_verification: {
      source: 'SkillBundle.output_schema.validation',
      reference_source: `${ONES_CONTRACT_REFERENCE_ASSET.repo}/references/09-二次验证清单.md`,
      required_checks: schema.validation,
      enforcement: 'model_output_runtime_validation',
    },
    report_style_reference: 'references/12-报告样式标准.md',
    templates: {
      report: {
        reference: 'references/12-报告样式标准.md',
        role: 'auxiliary',
        must_use_same_fact_set_as_comments: true,
      },
      comment: {
        primary_output: 'word_native_comment',
        author: 'ONES 业务运营',
        must_bind: ['RiskFinding', 'RuleSnapshot', 'evidence_text', 'source_range', 'Word comment anchor'],
        on_location_missing: 'manual_location_required',
      },
    },
    comment_template: {
      primary_output: 'word_native_comment',
      author: 'ONES 业务运营',
      must_bind: ['RiskFinding', 'RuleSnapshot', 'evidence_text', 'source_range', 'Word comment anchor'],
      on_location_missing: 'manual_location_required',
    },
    published_rule_scope: {
      rule_count: rules.length,
      rule_snapshot_count: snapshotRefs.length,
      source: 'current_published_rule_set_snapshots',
    },
    execution_plan: [
      'structured_rules',
      'template_compare',
      'semantic_review',
      'comment_patch_draft',
      'negotiation_task_generation',
      'report_summary',
    ],
    rules: snapshotRefs,
    rule_units: ruleUnits,
    rule_translation_gate: ruleTranslationGate,
    rule_set_snapshot_gate: ruleSetSnapshotGate,
    rule_sets: publishedRuleSetAssets.map((ruleSet) => ({
      id: ruleSet.id,
      code: ruleSet.code,
      name: ruleSet.name,
      version: ruleSet.version,
      lifecycle_status: ruleSet.lifecycle_status,
      translation_status: ruleSet.translation_status,
      published_at: ruleSet.published_at,
    })),
    rule_set_documents: ruleSetDocuments.map((document) => ({
      id: document.id,
      rule_set_id: document.rule_set_id,
      title: document.title,
      source_type: document.source_type,
      source_uri: document.source_uri,
      content_hash: document.content_hash,
      version: document.version,
      status: document.status,
      translation_status: document.translation_status,
      updated_at: document.updated_at,
    })),
    rule_set_document_gate: ruleSetDocumentGate,
    template_references: [],
    eval_results: {
      source_type: 'snapshot_bound_rule_acceptance',
      reference_eval_source: `${ONES_CONTRACT_REFERENCE_ASSET.repo}/skills/${ONES_CONTRACT_REFERENCE_ASSET.skill}/evals/evals.json`,
      commit: ONES_CONTRACT_REFERENCE_ASSET.commit,
      gate: 'current_version_snapshot_bound_rule_acceptance',
      rule_acceptance_status: evalStatus,
      model_quality_eval_status: 'blocked_without_independent_gold',
      total_rules: evalSummary.total_rules,
      passed_rules: evalSummary.passed_rules,
      total_cases: evalSummary.required_cases,
      passed_cases: evalSummary.passed_cases,
      failed_cases: [
        ...evalSummary.blocking_reasons,
        ...(ruleTranslationGate.status === 'ready' ? [] : ruleTranslationGate.blocking_reasons),
        ...(ruleSetSnapshotGate.status === 'ready' ? [] : ruleSetSnapshotGate.blocking_reasons),
        ...(ruleSetDocumentGate.status === 'ready' ? [] : ruleSetDocumentGate.blocking_reasons),
      ],
      runtime_eval_status: 'model_quality_eval_not_run',
      static_eval_status: 'reference_only_not_release_evidence',
      reference_case_ids: ONES_SKILL_EVAL_CASES,
      note: 'Passed means every current canonical RuleSnapshot has a complete asserted acceptance matrix frozen by its exact current RuleSetSnapshot. External reference cases and translation readiness are not release evidence. Model-quality accuracy remains a separate gold-set gate.',
    },
    output_schema_version: schema.schema_version,
  }
  const immutableBundleContent = {
    rule_snapshot_ids: snapshotRefs.map((ref) => ref.id),
    rule_set_snapshot_ids: ruleSetSnapshotIds,
    template_snapshot_ids: [] as string[],
    document_snapshot_ids: documentSnapshotIds,
    output_schema: schema,
    model_policy_id: null,
    eval_case_ids: ONES_SKILL_EVAL_CASES,
    compiled_from: compiledFrom,
  }
  const compiledHash = hashContractSkillBundleContent(immutableBundleContent)
  const reusable = bundleStatus === 'compiled'
    ? await fetchReusableBundle(orgId, compiledHash, bundleStatus)
    : await fetchCurrentBundle(orgId)
  if (
    reusable?.compiled_hash === compiledHash
    && reusable.status === bundleStatus
    && (
      bundleStatus === 'published'
        ? isContractSkillBundleFormalReviewAllowed(reusable)
        : reusable.is_current === false && reusable.published_at === null
    )
  ) return reusable

  const releaseMeta = {
    product_scope: 'F005_CONTRACT_REVIEW_WORKBENCH',
    runtime_owner: 'F006',
    model_owner: 'F012',
    release_type: 'auto_compile_from_published_assets',
    production_rule_source: CONFIG_CENTER_RULE_SOURCE,
    reference_asset: ONES_CONTRACT_REFERENCE_ASSET,
    reference_asset_count: ONES_SKILL_REFERENCES.length,
    rule_count: snapshotRefs.length,
    rule_set_count: ruleSetSnapshots.length,
    rule_set_snapshot_count: ruleSetSnapshotIds.length,
    rule_set_document_count: ruleSetDocuments.length,
    published_rule_count: snapshotRefs.length,
    published_rule_scope_status: ruleSetSnapshotGate.status,
    rule_translation_status: ruleTranslationGate.status,
    rule_set_document_status: ruleSetDocumentGate.status,
    official_review_allowed: formalReviewAllowed,
    review_gate_status: formalReviewAllowed ? 'formal_review_allowed' : 'compiled_not_formal',
    template_reference_count: 0,
    output_schema_version: schema.schema_version,
    second_verification_required: true,
    audit_required: true,
    compiled_by: requestedBy || 'system',
  }
  return persistContractSkillBundle({
    orgId,
    status: bundleStatus,
    compiledHash,
    requestedBy,
    payload: {
      ...immutableBundleContent,
      release_meta: releaseMeta,
    },
  })
}
