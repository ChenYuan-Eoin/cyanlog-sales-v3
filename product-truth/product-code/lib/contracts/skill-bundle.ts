import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import {
  resolvePublishedModelPolicy,
  type ContractModelPolicy,
} from '@/lib/contracts/model-policy'
import {
  buildRuleUnits,
  summarizeRuleTranslationGate,
} from '@/lib/contracts/rule-unit'

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
  rule_set_id: string
  version: number | null
  status: string | null
}

type ClauseTemplateRow = {
  id: string
  category: string
  name: string
  stance: string
  contract_types: string[] | null
  updated_at: string | null
}

type SkillBundleRow = Omit<ContractSkillBundle, 'model_policy' | 'compiled_from' | 'output_schema'> & {
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

type FormalReviewBundleGateInput = {
  status?: string | null
  is_current?: boolean | null
  published_at?: string | null
  release_meta?: unknown
  compiled_from?: unknown
}

function resolveBundleEvalStatus(input: {
  missingCanonicalRules: string[]
  ruleTranslationStatus: string
}): BundleEvalStatus {
  if (input.missingCanonicalRules.length > 0 || input.ruleTranslationStatus !== 'ready') {
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
  model_policy_id: string
  model_policy: ContractModelPolicy
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
  const ruleSetDocumentGate = asRecord(compiledFrom.rule_set_document_gate)
  const evalResults = asRecord(compiledFrom.eval_results)

  return bundle.status === 'published'
    && bundle.is_current === true
    && Boolean(bundle.published_at)
    && booleanValue(releaseMeta.official_review_allowed) === true
    && stringValue(ruleTranslationGate.status) === 'ready'
    && booleanValue(ruleTranslationGate.official_review_allowed) === true
    && stringValue(ruleSetDocumentGate.status) === 'ready'
    && stringValue(evalResults.status) === 'passed'
}

function normalizeBundle(row: SkillBundleRow, modelPolicy: ContractModelPolicy): ContractSkillBundle {
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
    model_policy: modelPolicy,
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

async function loadRules(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('contract_rules_v2')
    .select('id, rule_set_id, code, name, business_domain, risk_level, applicable_scenarios, scope, lifecycle_status, translation_status, version, engine_type, target_field, clause_category, field_hints, semantic_prompt, message_template, priority, updated_at, published_at')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .eq('lifecycle_status', 'published')
    .eq('translation_status', 'ready')
    .not('published_at', 'is', null)
    .order('code', { ascending: true })

  if (error) throw error
  return (data || []) as RuleRow[]
}

async function loadClauseTemplates(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('clause_library')
    .select('id, category, name, stance, contract_types, updated_at')
    .or(`org_id.is.null,org_id.eq.${orgId}`)
    .order('category', { ascending: true })

  if (error) return []
  return (data || []) as ClauseTemplateRow[]
}

async function loadPublishedRuleSnapshots(rules: RuleRow[]) {
  if (rules.length === 0) return []

  const { data, error } = await supabaseAdmin
    .from('contract_rule_snapshots')
    .select('id, rule_id, version, status, released_at, created_at, config_snapshot')
    .in('rule_id', rules.map((rule) => rule.id))
    .eq('status', 'published')
    .order('released_at', { ascending: false })

  if (error) throw error
  return (data || []) as RuleSnapshotRow[]
}

async function loadRuleSetsWithLatestDocuments(orgId: string, ruleSetIds: string[]) {
  const uniqueIds = Array.from(new Set(ruleSetIds.filter(Boolean)))
  if (uniqueIds.length === 0) {
    return { ruleSets: [] as RuleSetRow[], documents: [] as RuleSetDocumentRow[] }
  }

  const [ruleSetResult, documentResult] = await Promise.all([
    supabaseAdmin
      .from('contract_rule_sets')
      .select('id, code, name, description, version, lifecycle_status, translation_status, published_at')
      .eq('org_id', orgId)
      .in('id', uniqueIds),
    supabaseAdmin
      .from('contract_rule_set_documents')
      .select('id, rule_set_id, title, source_type, source_uri, content_hash, version, status, translation_status, updated_at')
      .eq('org_id', orgId)
      .in('rule_set_id', uniqueIds)
      .neq('status', 'archived')
      .order('version', { ascending: false }),
  ])

  if (ruleSetResult.error) throw ruleSetResult.error
  if (documentResult.error) throw documentResult.error

  const latestDocuments = new Map<string, RuleSetDocumentRow>()
  for (const document of (documentResult.data || []) as RuleSetDocumentRow[]) {
    if (!latestDocuments.has(document.rule_set_id)) {
      latestDocuments.set(document.rule_set_id, document)
    }
  }

  return {
    ruleSets: (ruleSetResult.data || []) as RuleSetRow[],
    documents: Array.from(latestDocuments.values()),
  }
}

function summarizeRuleSetDocumentGate(ruleSets: RuleSetRow[], documents: RuleSetDocumentRow[]): RuleSetDocumentGate {
  const documentsBySetId = new Map(documents.map((document) => [document.rule_set_id, document]))
  const blockingReasons: string[] = []
  let readyDocuments = 0

  for (const ruleSet of ruleSets) {
    const document = documentsBySetId.get(ruleSet.id)
    if (!document) {
      blockingReasons.push(`ruleset_document_missing:${ruleSet.code}`)
      continue
    }
    if (document.status !== 'published') {
      blockingReasons.push(`ruleset_document_not_published:${ruleSet.code}`)
      continue
    }
    if (document.translation_status !== 'ready') {
      blockingReasons.push(`ruleset_document_translation_not_ready:${ruleSet.code}`)
      continue
    }
    readyDocuments += 1
  }

  return {
    status: blockingReasons.length === 0 && ruleSets.length > 0 ? 'ready' : 'failed',
    total_rule_sets: ruleSets.length,
    ready_documents: readyDocuments,
    blocking_reasons: blockingReasons,
  }
}

async function ensureRuleSetSnapshots(input: {
  orgId: string
  ruleSets: RuleSetRow[]
  documents: RuleSetDocumentRow[]
  ruleSnapshotIdsBySetId: Map<string, string[]>
  status: 'draft' | 'published'
  requestedBy?: string | null
}) {
  if (input.ruleSets.length === 0) return [] as RuleSetSnapshotRow[]

  const documentsBySetId = new Map(input.documents.map((document) => [document.rule_set_id, document]))
  const now = new Date().toISOString()
  const rows = input.ruleSets.map((ruleSet) => {
    const document = documentsBySetId.get(ruleSet.id)
    return {
      org_id: input.orgId,
      rule_set_id: ruleSet.id,
      version: ruleSet.version || 1,
      status: input.status,
      rule_snapshot_ids: input.ruleSnapshotIdsBySetId.get(ruleSet.id) || [],
      document_snapshot_ids: document ? [document.id] : [],
      config_snapshot: {
        code: ruleSet.code,
        name: ruleSet.name,
        description: ruleSet.description,
        lifecycle_status: ruleSet.lifecycle_status,
        translation_status: ruleSet.translation_status,
        latest_document: document
          ? {
              id: document.id,
              title: document.title,
              source_type: document.source_type,
              source_uri: document.source_uri,
              content_hash: document.content_hash,
              version: document.version,
              status: document.status,
              translation_status: document.translation_status,
            }
          : null,
      },
      released_by: input.status === 'published' ? input.requestedBy || null : null,
      released_at: input.status === 'published' ? now : null,
      release_note: input.status === 'published'
        ? 'SkillBundle 编译时冻结规则集与文档快照'
        : 'SkillBundle 编译未过正式门，保留规则集草稿快照',
    }
  })

  const { data, error } = await supabaseAdmin
    .from('contract_rule_set_snapshots')
    .upsert(rows, { onConflict: 'rule_set_id,version,status' })
    .select('id, rule_set_id, version, status')

  if (error) throw error
  return (data || []) as RuleSetSnapshotRow[]
}

async function fetchCurrentBundle(orgId: string, modelPolicy: ContractModelPolicy) {
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
  const bundle = normalizeBundle(data as SkillBundleRow, modelPolicy)
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
  const modelPolicy = await resolvePublishedModelPolicy(orgId, requestedBy)
  const [rules, templates] = await Promise.all([
    loadRules(orgId),
    loadClauseTemplates(orgId),
  ])
  const snapshots = await loadPublishedRuleSnapshots(rules)
  const snapshotsByRuleId = new Map(
    rules
      .map((rule) => [rule.id, findSnapshotForRule(rule, snapshots)] as const)
      .filter((entry): entry is readonly [string, RuleSnapshotRow] => Boolean(entry[1]))
  )
  const ruleUnits = buildRuleUnits(rules, snapshotsByRuleId)
  const ruleTranslationGate = summarizeRuleTranslationGate(ruleUnits)
  const rulesById = new Map(rules.map((rule) => [rule.id, rule]))
  const ruleSetIds = Array.from(new Set(
    rules
      .map((rule) => rule.rule_set_id)
      .filter((id): id is string => Boolean(id))
  ))
  const { ruleSets: ruleSetAssets, documents: ruleSetDocuments } = await loadRuleSetsWithLatestDocuments(orgId, ruleSetIds)
  const ruleSetDocumentGate = summarizeRuleSetDocumentGate(ruleSetAssets, ruleSetDocuments)
  const snapshotRefs = ruleUnits
    .filter((unit) => unit.source_trace.snapshot_id)
    .map((unit) => ({
      id: unit.id,
      rule_id: unit.rule_id,
      rule_set_id: rulesById.get(unit.rule_id)?.rule_set_id || null,
      code: unit.code,
      version: unit.version,
      business_domain: unit.business_domain,
      risk_level: unit.risk_level,
      applicable_scenarios: unit.applicable_scenarios,
      scope: unit.scope,
      engine_type: unit.engine_type,
      target_field: unit.target_field,
      clause_category: unit.clause_category,
      field_hints: unit.field_hints,
      translation_status: unit.translation.status,
    }))

  const templateRefs = templates.map((template) => ({
    id: template.id,
    category: template.category,
    name: template.name,
    stance: template.stance,
    contract_types: template.contract_types || [],
    updated_at: template.updated_at,
  }))
  const schema = outputSchema()
  const ruleCodes = new Set(rules.map((rule) => rule.code))
  const missingCanonicalRules = Array.from({ length: 15 }, (_, index) => `R${String(index + 1).padStart(3, '0')}`)
    .filter((code) => !ruleCodes.has(code))
  const evalStatus = resolveBundleEvalStatus({
    missingCanonicalRules,
    ruleTranslationStatus: ruleTranslationGate.status,
  })
  const formalReviewAllowed = ruleTranslationGate.official_review_allowed
    && ruleSetDocumentGate.status === 'ready'
    && evalStatus === 'passed'
  const bundleStatus: ContractSkillBundle['status'] = formalReviewAllowed ? 'published' : 'compiled'
  const ruleSnapshotIdsBySetId = new Map<string, string[]>()
  for (const ref of snapshotRefs) {
    if (!ref.rule_set_id) continue
    const existing = ruleSnapshotIdsBySetId.get(ref.rule_set_id) || []
    existing.push(ref.id)
    ruleSnapshotIdsBySetId.set(ref.rule_set_id, existing)
  }
  const ruleSetSnapshots = await ensureRuleSetSnapshots({
    orgId,
    ruleSets: ruleSetAssets,
    documents: ruleSetDocuments,
    ruleSnapshotIdsBySetId,
    status: formalReviewAllowed ? 'published' : 'draft',
    requestedBy,
  })
  const ruleSetSnapshotIds = ruleSetSnapshots.map((snapshot) => snapshot.id)
  const documentSnapshotIds = ruleSetDocuments.map((document) => document.id)

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
    canonical_rule_completeness: {
      expected: 15,
      actual: ruleCodes.size,
      missing: missingCanonicalRules,
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
    rule_sets: ruleSetAssets.map((ruleSet) => ({
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
    template_references: templateRefs,
    eval_results: {
      source_type: 'reference_asset',
      reference_eval_source: `${ONES_CONTRACT_REFERENCE_ASSET.repo}/skills/${ONES_CONTRACT_REFERENCE_ASSET.skill}/evals/evals.json`,
      commit: ONES_CONTRACT_REFERENCE_ASSET.commit,
      gate: 'first_stage_static_publication_eval',
      status: evalStatus,
      total_cases: ONES_SKILL_EVAL_CASES.length,
      passed_cases: evalStatus === 'passed' ? ONES_SKILL_EVAL_CASES.length : 0,
      failed_cases: [
        ...(missingCanonicalRules.length === 0 ? [] : ['canonical_rule_completeness']),
        ...(ruleTranslationGate.status === 'ready' ? [] : ruleTranslationGate.blocking_reasons),
        ...(ruleSetDocumentGate.status === 'ready' ? [] : ruleSetDocumentGate.blocking_reasons),
      ],
      runtime_eval_status: 'model_quality_eval_not_run',
      static_eval_status: evalStatus,
      case_ids: ONES_SKILL_EVAL_CASES,
      note: 'First-stage static publication eval verifies config-center published rules, RuleUnit readiness, published snapshots, and output schema binding. It does not claim model-quality eval has been run.',
    },
    model_policy: {
      id: modelPolicy.id,
      version: modelPolicy.version,
      routing_policy: modelPolicy.routing_policy,
      fallback_policy: modelPolicy.fallback_policy,
      provider_chain: modelPolicy.provider_chain.map((provider) => ({
        profile: provider.profile,
        provider_kind: provider.provider_kind,
        model: provider.model,
        runtime_location: provider.runtime_location,
        level: provider.level,
        stages: provider.stages,
        role: provider.role,
        capabilities: provider.capabilities,
      })),
    },
    output_schema_version: schema.schema_version,
  }
  const compiledHash = stableHash(compiledFrom)

  const [current, latestVersion] = await Promise.all([
    fetchCurrentBundle(orgId, modelPolicy),
    fetchLatestBundleVersion(orgId),
  ])
  if (
    current?.compiled_hash === compiledHash
    && current.model_policy_id === modelPolicy.id
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
      model_policy_id: modelPolicy.id,
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
        rule_set_count: ruleSetAssets.length,
        rule_set_snapshot_count: ruleSetSnapshotIds.length,
        rule_set_document_count: ruleSetDocuments.length,
        canonical_rule_count: ruleCodes.size,
        canonical_rule_missing: missingCanonicalRules,
        rule_translation_status: ruleTranslationGate.status,
        rule_set_document_status: ruleSetDocumentGate.status,
        official_review_allowed: formalReviewAllowed,
        review_gate_status: formalReviewAllowed ? 'formal_review_allowed' : 'compiled_not_formal',
        template_reference_count: templateRefs.length,
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
    const refetched = await fetchCurrentBundle(orgId, modelPolicy)
    if (refetched) return refetched
    throw error
  }

  return normalizeBundle(data as SkillBundleRow, modelPolicy)
}
