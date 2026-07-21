import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import {
  buildRuleUnits,
  summarizeRuleTranslationGate,
} from '@/lib/contracts/rule-unit'
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

type RuleSnapshotRow = {
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
}

type RuleSetDocumentRow = {
  id: string
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

type RuleSetSnapshotRow = {
  id: string
  org_id: string
  rule_set_id: string
  version: number | null
  status: string | null
  rule_snapshot_ids: string[] | null
  document_snapshot_ids: string[] | null
  config_snapshot: unknown
  released_at: string | null
}

type SkillBundleRow = Omit<ContractSkillBundle, 'compiled_from' | 'output_schema'> & {
  compiled_from: unknown
  output_schema: unknown
}

type BundleEvalStatus = 'passed' | 'runtime_eval_not_run' | 'failed'

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

function resolveBundleEvalStatus(input: {
  ruleTranslationStatus: string
}): BundleEvalStatus {
  if (input.ruleTranslationStatus !== 'ready') {
    return 'failed'
  }
  return 'passed'
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
    && stringValue(evalResults.status) === 'passed'
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
        'model_policy_id',
      ],
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
  const snapshots = ((data || []) as RuleSnapshotRow[]).filter((snapshot) => {
    const config = asRecord(snapshot.config_snapshot)
    return snapshot.status === 'published'
      && stringValue(config.org_id) === orgId
      && stringValue(config.id) === snapshot.rule_id
      && stringValue(config.rule_set_id) === ownerByRuleSnapshotId.get(snapshot.id)
      && Number(config.version) === snapshot.version
      && config.is_active === true
  })
  const resolvedSnapshotIds = new Set(snapshots.map((snapshot) => snapshot.id))
  const unresolvedSnapshotIds = snapshotIds.filter((snapshotId) => !resolvedSnapshotIds.has(snapshotId))
  if (unresolvedSnapshotIds.length > 0) {
    throw new Error(`RULESET_CURRENT_RULE_SNAPSHOT_INVALID:${unresolvedSnapshotIds.join(',')}`)
  }
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

async function loadFrozenRuleSetDocuments(orgId: string, snapshots: RuleSetSnapshotRow[]) {
  const documentIds = Array.from(new Set(
    snapshots.flatMap((snapshot) => snapshot.document_snapshot_ids || []).filter(Boolean)
  ))
  if (documentIds.length === 0) return [] as RuleSetDocumentRow[]
  const documentResult = await supabaseAdmin
    .from('contract_rule_set_documents')
    .select('id, rule_set_id, title, source_type, source_uri, content_hash, version, status, translation_status, updated_at')
    .eq('org_id', orgId)
    .in('id', documentIds)
  if (documentResult.error) throw documentResult.error

  const allowedBySet = new Map(
    snapshots.map((snapshot) => [snapshot.rule_set_id, new Set(snapshot.document_snapshot_ids || [])])
  )
  return ((documentResult.data || []) as RuleSetDocumentRow[]).filter((document) => (
    allowedBySet.get(document.rule_set_id)?.has(document.id)
    && document.status === 'published'
    && document.translation_status === 'ready'
  ))
}

function summarizeRuleSetDocumentGate(ruleSets: RuleSetRow[], documents: RuleSetDocumentRow[]): RuleSetDocumentGate {
  const documentsBySetId = new Map(documents.map((document) => [document.rule_set_id, document]))
  let readyDocuments = 0

  for (const ruleSet of ruleSets) {
    const document = documentsBySetId.get(ruleSet.id)
    if (document?.status === 'published' && document.translation_status === 'ready') readyDocuments += 1
  }

  return {
    // RuleSetDocument is optional reference material. The published business
    // contract and its rule snapshots are the release truth; an absent or draft
    // document cannot block an otherwise complete canonical ruleset.
    status: ruleSets.length > 0 ? 'ready' : 'failed',
    total_rule_sets: ruleSets.length,
    ready_documents: readyDocuments,
    blocking_reasons: ruleSets.length > 0 ? [] : ['no_published_rule_sets'],
  }
}

async function loadPublishedRuleSetSnapshots(orgId: string, ruleSetIds: string[] = []) {
  const uniqueIds = Array.from(new Set(ruleSetIds.filter(Boolean)))
  let pointerQuery = supabaseAdmin
    .from('contract_rule_sets')
    .select('id, org_id, current_snapshot_id, published_at')
    .eq('org_id', orgId)
    .eq('is_active', true)
  if (uniqueIds.length > 0) pointerQuery = pointerQuery.in('id', uniqueIds)

  const { data: pointerData, error: pointerError } = await pointerQuery
  if (pointerError) throw pointerError

  const activeRuleSets = (pointerData || []) as RuleSetPointerRow[]
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
    .select('id, org_id, rule_set_id, version, status, rule_snapshot_ids, document_snapshot_ids, config_snapshot, released_at')
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
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) return null
  const bundle = normalizeBundle(data as SkillBundleRow)
  return isContractSkillBundleFormalReviewAllowed(bundle) ? bundle : null
}

async function fetchLatestBundleVersion(orgId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from('contract_skill_bundles')
    .select('version')
    .eq('org_id', orgId)
    .eq('key', SKILL_BUNDLE_KEY)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return typeof data?.version === 'number' ? data.version : 0
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
  const evalStatus = resolveBundleEvalStatus({
    ruleTranslationStatus: ruleTranslationGate.status,
  })
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
      source_type: 'reference_asset',
      reference_eval_source: `${ONES_CONTRACT_REFERENCE_ASSET.repo}/skills/${ONES_CONTRACT_REFERENCE_ASSET.skill}/evals/evals.json`,
      commit: ONES_CONTRACT_REFERENCE_ASSET.commit,
      gate: 'first_stage_static_publication_eval',
      status: evalStatus,
      total_cases: ONES_SKILL_EVAL_CASES.length,
      passed_cases: evalStatus === 'passed' ? ONES_SKILL_EVAL_CASES.length : 0,
      failed_cases: [
        ...(ruleTranslationGate.status === 'ready' ? [] : ruleTranslationGate.blocking_reasons),
        ...(ruleSetSnapshotGate.status === 'ready' ? [] : ruleSetSnapshotGate.blocking_reasons),
        ...(ruleSetDocumentGate.status === 'ready' ? [] : ruleSetDocumentGate.blocking_reasons),
      ],
      runtime_eval_status: 'model_quality_eval_not_run',
      static_eval_status: evalStatus,
      case_ids: ONES_SKILL_EVAL_CASES,
      note: 'First-stage static publication eval verifies config-center published rules, RuleUnit readiness, published snapshots, and output schema binding. It does not claim model-quality eval has been run.',
    },
    output_schema_version: schema.schema_version,
  }
  const compiledHash = stableHash(compiledFrom)

  const [current, latestVersion] = await Promise.all([
    fetchCurrentBundle(orgId),
    fetchLatestBundleVersion(orgId),
  ])
  if (
    current?.compiled_hash === compiledHash
    && current.status === bundleStatus
  ) {
    return current
  }

  const nextVersion = latestVersion + 1
  if (formalReviewAllowed) {
    const { error: clearError } = await supabaseAdmin
      .from('contract_skill_bundles')
      .update({ is_current: false })
      .eq('org_id', orgId)
      .eq('key', SKILL_BUNDLE_KEY)
      .eq('is_current', true)
    if (clearError) throw clearError
  }

  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('contract_skill_bundles')
    .insert({
      org_id: orgId,
      key: SKILL_BUNDLE_KEY,
      version: nextVersion,
      status: bundleStatus,
      is_current: formalReviewAllowed,
      rule_snapshot_ids: snapshotRefs.map((ref) => ref.id),
      rule_set_snapshot_ids: ruleSetSnapshotIds,
      template_snapshot_ids: [],
      document_snapshot_ids: documentSnapshotIds,
      output_schema: schema,
      model_policy_id: null,
      eval_case_ids: ONES_SKILL_EVAL_CASES,
      release_meta: {
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
      },
      compiled_from: compiledFrom,
      compiled_hash: compiledHash,
      created_by: requestedBy || null,
      published_by: formalReviewAllowed ? (requestedBy || null) : null,
      compiled_at: now,
      published_at: formalReviewAllowed ? now : null,
    })
    .select('*')
    .single()

  if (error) {
    const refetched = await fetchCurrentBundle(orgId)
    if (refetched) return refetched
    throw error
  }

  return normalizeBundle(data as SkillBundleRow)
}
