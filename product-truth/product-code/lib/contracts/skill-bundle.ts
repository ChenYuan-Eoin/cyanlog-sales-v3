import crypto from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import {
  resolvePublishedModelPolicy,
  type ContractModelPolicy,
} from '@/lib/contracts/model-policy'

type JsonRecord = Record<string, unknown>

const SKILL_BUNDLE_KEY = 'CONTRACT_REVIEW_DEFAULT'
const ONES_CONTRACT_SKILL_SOURCE = {
  repo: 'suoyidev/ones-internal-skills',
  url: 'https://github.com/suoyidev/ones-internal-skills',
  commit: 'f8b0c27f5c19a499c1563923ca372a2171aaca58',
  skill: 'ones-contract-assistant',
  version: '2.2.2',
  last_updated: '2026-06-16',
  product_override: 'ONES Sales 第一阶段采用批注为主、报告为辅；原仓库中“原合同逐字审查已取消”的口径在本产品内被替换为 Word 原生批注主路径。',
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
  'evals/payment-schedule',
  'evals/acceptance-silent-period',
  'evals/confidentiality-period',
  'evals/sla-redline',
  'evals/dispute-resolution',
]

type RuleRow = {
  id: string
  code: string
  name: string
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

export type ContractSkillBundle = {
  id: string
  org_id: string
  key: string
  version: number
  status: 'draft' | 'compiled' | 'published' | 'archived'
  is_current: boolean
  rule_snapshot_ids: string[]
  template_snapshot_ids: string[]
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

function normalizeBundle(row: SkillBundleRow, modelPolicy: ContractModelPolicy): ContractSkillBundle {
  return {
    ...row,
    rule_snapshot_ids: Array.isArray(row.rule_snapshot_ids) ? row.rule_snapshot_ids : [],
    template_snapshot_ids: Array.isArray(row.template_snapshot_ids) ? row.template_snapshot_ids : [],
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
      required: ['contract_version_id', 'skill_bundle_id', 'rule_snapshot_ids', 'model_policy_id'],
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
      fallback_when_position_missing: 'paragraph_level_comment_or_report_only',
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
    .select('id, code, name, version, engine_type, target_field, clause_category, field_hints, semantic_prompt, message_template, priority, updated_at, published_at')
    .eq('org_id', orgId)
    .eq('is_active', true)
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

async function ensurePublishedRuleSnapshots(
  rules: RuleRow[],
  requestedBy?: string | null
) {
  if (rules.length === 0) return []

  const { data, error } = await supabaseAdmin
    .from('contract_rule_snapshots')
    .select('id, rule_id, version, status, released_at, created_at, config_snapshot')
    .in('rule_id', rules.map((rule) => rule.id))
    .eq('status', 'published')
    .order('released_at', { ascending: false })

  if (error) throw error

  const snapshots = (data || []) as RuleSnapshotRow[]
  const missingRules = rules.filter((rule) => !findSnapshotForRule(rule, snapshots))
  if (missingRules.length === 0) return snapshots

  const releasedAt = new Date().toISOString()
  const { data: inserted, error: insertError } = await supabaseAdmin
    .from('contract_rule_snapshots')
    .insert(missingRules.map((rule) => ({
      rule_id: rule.id,
      version: rule.version || 1,
      config_snapshot: rule,
      released_by: requestedBy || null,
      released_at: releasedAt,
      release_note: 'Auto-published snapshot for F006 SkillBundle compilation',
      status: 'published',
    })))
    .select('id, rule_id, version, status, released_at, created_at, config_snapshot')

  if (insertError) throw insertError
  return [...snapshots, ...((inserted || []) as RuleSnapshotRow[])]
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
  return data ? normalizeBundle(data as SkillBundleRow, modelPolicy) : null
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
  const snapshots = await ensurePublishedRuleSnapshots(rules, requestedBy)
  const snapshotRefs = rules
    .map((rule) => {
      const snapshot = findSnapshotForRule(rule, snapshots)
      return snapshot
        ? {
            id: snapshot.id,
            rule_id: rule.id,
            code: rule.code,
            version: snapshot.version ?? rule.version ?? 1,
            engine_type: rule.engine_type || 'structured',
            target_field: rule.target_field,
            clause_category: rule.clause_category,
          }
        : null
    })
    .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))

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
  const compiledFrom = {
    product_phase: 'contract_review_first_stage',
    skill_key: SKILL_BUNDLE_KEY,
    external_skill_source: ONES_CONTRACT_SKILL_SOURCE,
    external_skill_references: ONES_SKILL_REFERENCES.map((reference) => ({
      path: reference,
      source: `${ONES_CONTRACT_SKILL_SOURCE.repo}/${reference}`,
    })),
    output_schema_reference: 'references/13-结构化输出schema.md',
    second_verification_reference: 'references/09-二次验证清单.md',
    report_style_reference: 'references/12-报告样式标准.md',
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
    template_references: templateRefs,
    model_policy: {
      id: modelPolicy.id,
      version: modelPolicy.version,
      routing_policy: modelPolicy.routing_policy,
      fallback_policy: modelPolicy.fallback_policy,
      provider_chain: modelPolicy.provider_chain.map((provider) => ({
        profile: provider.profile,
        provider_kind: provider.provider_kind,
        model: provider.model,
        level: provider.level,
        stages: provider.stages,
        role: provider.role,
        capabilities: provider.capabilities,
      })),
    },
    output_schema_version: schema.schema_version,
  }
  const compiledHash = stableHash(compiledFrom)

  const current = await fetchCurrentBundle(orgId, modelPolicy)
  if (current?.compiled_hash === compiledHash && current.model_policy_id === modelPolicy.id) {
    return current
  }

  const nextVersion = (current?.version || 0) + 1
  if (current) {
    const { error: clearError } = await supabaseAdmin
      .from('contract_skill_bundles')
      .update({ is_current: false })
      .eq('id', current.id)
    if (clearError) throw clearError
  }

  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('contract_skill_bundles')
    .insert({
      org_id: orgId,
      key: SKILL_BUNDLE_KEY,
      version: nextVersion,
      status: 'published',
      is_current: true,
      rule_snapshot_ids: snapshotRefs.map((ref) => ref.id),
      template_snapshot_ids: [],
      output_schema: schema,
      model_policy_id: modelPolicy.id,
      eval_case_ids: ONES_SKILL_EVAL_CASES,
      release_meta: {
        product_scope: 'F005_CONTRACT_REVIEW_WORKBENCH',
        runtime_owner: 'F006',
        model_owner: 'F012',
        release_type: 'auto_compile_from_published_assets',
        external_skill_source: ONES_CONTRACT_SKILL_SOURCE,
        external_reference_count: ONES_SKILL_REFERENCES.length,
        rule_count: snapshotRefs.length,
        canonical_rule_count: ruleCodes.size,
        canonical_rule_missing: missingCanonicalRules,
        template_reference_count: templateRefs.length,
        output_schema_version: schema.schema_version,
        second_verification_required: true,
        audit_required: true,
        compiled_by: requestedBy || 'system',
      },
      compiled_from: compiledFrom,
      compiled_hash: compiledHash,
      created_by: requestedBy || null,
      published_by: requestedBy || null,
      compiled_at: now,
      published_at: now,
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
