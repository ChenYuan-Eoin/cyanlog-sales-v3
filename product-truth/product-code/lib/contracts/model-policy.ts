import { supabaseAdmin } from '@/lib/supabase'
import { listPublishedAIProviders, type PublishedAIProviderConfig } from '@/lib/configs/runtime'

type JsonRecord = Record<string, unknown>

const MODEL_POLICY_KEY = 'CONTRACT_REVIEW_DEFAULT'

export type ModelPolicyStage =
  | 'structured_rules'
  | 'template_compare'
  | 'semantic_review'
  | 'comment_patch_draft'
  | 'report_summary'
  | 'rule_fallback'

export type ModelPolicyProvider = {
  profile: string
  provider_kind: 'openai_compatible' | 'builtin'
  provider: string
  model: string
  level: number
  timeout_ms: number
  stages: ModelPolicyStage[]
  role: 'primary' | 'fallback'
  capabilities: string[]
  data_boundary: 'contract_text_redacted' | 'contract_text_allowed' | 'rules_only'
  health_check_required: boolean
  routing?: {
    max_pages: number
    strategy: 'full' | 'chunked' | 'rule'
  }
  source_config_id: string | null
}

export type ContractModelPolicy = {
  id: string
  org_id: string
  key: string
  name: string
  version: number
  status: 'draft' | 'published' | 'archived'
  is_current: boolean
  provider_chain: ModelPolicyProvider[]
  routing_policy: JsonRecord
  timeout_ms: number
  fallback_policy: JsonRecord
  audit_policy: JsonRecord
  source_config_ids: string[]
  published_at: string | null
}

type ModelPolicyRow = Omit<ContractModelPolicy, 'provider_chain' | 'routing_policy' | 'fallback_policy' | 'audit_policy'> & {
  provider_chain: unknown
  routing_policy: unknown
  fallback_policy: unknown
  audit_policy: unknown
}

type InvocationInput = {
  orgId?: string | null
  contractId?: string | null
  reviewId?: string | null
  skillBundleId?: string | null
  modelPolicyId?: string | null
  provider: string
  model: string
  phase?: string
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'degraded'
  degraded?: boolean
  fallbackReason?: string | null
  latencyMs?: number
  requestMeta?: JsonRecord
  responseMeta?: JsonRecord
  errorMessage?: string | null
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function asStageList(value: unknown, fallback: ModelPolicyStage[]): ModelPolicyStage[] {
  if (!Array.isArray(value)) return fallback
  const allowed = new Set<ModelPolicyStage>([
    'structured_rules',
    'template_compare',
    'semantic_review',
    'comment_patch_draft',
    'report_summary',
    'rule_fallback',
  ])
  const stages = value.filter((stage): stage is ModelPolicyStage => (
    typeof stage === 'string' && allowed.has(stage as ModelPolicyStage)
  ))
  return stages.length > 0 ? stages : fallback
}

function asStringList(value: unknown, fallback: string[]) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : fallback
}

function normalizeProvider(row: PublishedAIProviderConfig): ModelPolicyProvider {
  const isBuiltin = row.provider_kind === 'builtin' || row.model === 'rule-engine'
  return {
    profile: String(row.profile || row.key || row.name || 'provider'),
    provider_kind: isBuiltin ? 'builtin' : 'openai_compatible',
    provider: isBuiltin ? 'rule-engine' : 'openai-compatible',
    model: row.model || 'unknown',
    level: Number(row.level || 1),
    timeout_ms: Number(row.timeout_ms || 45000),
    stages: isBuiltin
      ? ['structured_rules', 'rule_fallback']
      : ['semantic_review', 'comment_patch_draft', 'report_summary'],
    role: isBuiltin ? 'fallback' : 'primary',
    capabilities: isBuiltin
      ? ['deterministic_rule_scan', 'fallback_without_external_model']
      : ['semantic_clause_review', 'comment_patch_draft', 'report_summary'],
    data_boundary: isBuiltin ? 'rules_only' : 'contract_text_allowed',
    health_check_required: !isBuiltin,
    routing: row.routing,
    source_config_id: row.config_id,
  }
}

function ruleEngineProvider(level = 99): ModelPolicyProvider {
  return {
    profile: 'rule_engine',
    provider_kind: 'builtin',
    provider: 'rule-engine',
    model: 'rule-engine',
    level,
    timeout_ms: 15000,
    stages: ['structured_rules', 'rule_fallback'],
    role: 'fallback',
    capabilities: ['deterministic_rule_scan', 'schema_repair', 'fallback_without_external_model'],
    data_boundary: 'rules_only',
    health_check_required: false,
    routing: {
      max_pages: 1,
      strategy: 'rule',
    },
    source_config_id: null,
  }
}

function normalizeProviderChain(value: unknown): ModelPolicyProvider[] {
  if (!Array.isArray(value)) {
    return [ruleEngineProvider()]
  }

  const providers: ModelPolicyProvider[] = []
  for (const item of value) {
    const record = asRecord(item)
    const model = typeof record.model === 'string' ? record.model : ''
    if (!model) continue
    providers.push({
      profile: String(record.profile || model),
      provider_kind: record.provider_kind === 'builtin' ? 'builtin' : 'openai_compatible',
      provider: String(record.provider || (record.provider_kind === 'builtin' ? 'rule-engine' : 'openai-compatible')),
      model,
      level: Number(record.level || 1),
      timeout_ms: Number(record.timeout_ms || 45000),
      stages: asStageList(
        record.stages,
        record.provider_kind === 'builtin'
          ? ['structured_rules', 'rule_fallback']
          : ['semantic_review', 'comment_patch_draft', 'report_summary']
      ),
      role: record.role === 'fallback' ? 'fallback' : 'primary',
      capabilities: asStringList(
        record.capabilities,
        record.provider_kind === 'builtin'
          ? ['deterministic_rule_scan', 'fallback_without_external_model']
          : ['semantic_clause_review', 'comment_patch_draft', 'report_summary']
      ),
      data_boundary: record.data_boundary === 'contract_text_redacted'
        ? 'contract_text_redacted'
        : record.data_boundary === 'rules_only'
          ? 'rules_only'
          : 'contract_text_allowed',
      health_check_required: typeof record.health_check_required === 'boolean'
        ? record.health_check_required
        : record.provider_kind !== 'builtin',
      routing: asRecord(record.routing) as ModelPolicyProvider['routing'],
      source_config_id: typeof record.source_config_id === 'string' ? record.source_config_id : null,
    })
  }

  return providers.length > 0 ? providers : [ruleEngineProvider()]
}

function normalizeModelPolicy(row: ModelPolicyRow): ContractModelPolicy {
  return {
    ...row,
    provider_chain: normalizeProviderChain(row.provider_chain),
    routing_policy: asRecord(row.routing_policy),
    fallback_policy: asRecord(row.fallback_policy),
    audit_policy: asRecord(row.audit_policy),
    source_config_ids: Array.isArray(row.source_config_ids) ? row.source_config_ids : [],
  }
}

function buildProviderChain(providers: PublishedAIProviderConfig[]): ModelPolicyProvider[] {
  const chain = providers.map(normalizeProvider)
  return ensureRuleEngineProvider(chain)
}

function ensureRuleEngineProvider(chain: ModelPolicyProvider[]): ModelPolicyProvider[] {
  if (!chain.some((provider) => provider.provider_kind === 'builtin' && provider.model === 'rule-engine')) {
    chain.push(ruleEngineProvider(chain.length + 1))
  }
  return chain.sort((left, right) => left.level - right.level)
}

function isCompleteModelPolicy(policy: ContractModelPolicy) {
  return policy.routing_policy.policy_version === 'f012.model-policy.v1'
    && policy.fallback_policy.policy_version === 'f012.fallback.v1'
    && policy.audit_policy.policy_version === 'f012.audit.v1'
    && policy.provider_chain.every((provider) => (
      provider.stages.length > 0
      && provider.capabilities.length > 0
      && typeof provider.health_check_required === 'boolean'
    ))
}

function sameStringList(left: string[], right: string[]) {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

function sameRouting(
  left: ModelPolicyProvider['routing'] | undefined,
  right: ModelPolicyProvider['routing'] | undefined
) {
  if (!left && !right) return true
  if (!left || !right) return false
  return left.max_pages === right.max_pages && left.strategy === right.strategy
}

function sameProvider(left: ModelPolicyProvider, right: ModelPolicyProvider) {
  return left.profile === right.profile
    && left.provider_kind === right.provider_kind
    && left.provider === right.provider
    && left.model === right.model
    && left.level === right.level
    && left.timeout_ms === right.timeout_ms
    && left.role === right.role
    && left.data_boundary === right.data_boundary
    && left.health_check_required === right.health_check_required
    && left.source_config_id === right.source_config_id
    && sameStringList(left.stages, right.stages)
    && sameStringList(left.capabilities, right.capabilities)
    && sameRouting(left.routing, right.routing)
}

export function isModelPolicyCurrentForPublishedProviders(
  policy: ContractModelPolicy,
  providers: PublishedAIProviderConfig[]
) {
  const expectedChain = buildProviderChain(providers)
  if (policy.provider_chain.length !== expectedChain.length) {
    return false
  }

  const expectedSourceConfigIds = expectedChain
    .map((provider) => provider.source_config_id)
    .filter((id): id is string => Boolean(id))
  if (!sameStringList(policy.source_config_ids, expectedSourceConfigIds)) {
    return false
  }

  return expectedChain.every((expected, index) => sameProvider(policy.provider_chain[index], expected))
}

async function fetchCurrentModelPolicy(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('model_policies')
    .select('*')
    .eq('org_id', orgId)
    .eq('key', MODEL_POLICY_KEY)
    .eq('status', 'published')
    .eq('is_current', true)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data ? normalizeModelPolicy(data as ModelPolicyRow) : null
}

export async function resolvePublishedModelPolicy(
  orgId: string,
  requestedBy?: string | null
): Promise<ContractModelPolicy> {
  const current = await fetchCurrentModelPolicy(orgId)
  const providers = await listPublishedAIProviders(orgId).catch(() => null)
  if (
    current
    && isCompleteModelPolicy(current)
    && (
      providers === null
      || isModelPolicyCurrentForPublishedProviders(current, providers)
    )
  ) {
    return current
  }

  const configuredProviderChain = providers && providers.length > 0
    ? buildProviderChain(providers)
    : current?.provider_chain.length
      ? current.provider_chain
      : buildProviderChain([])
  const providerChain = ensureRuleEngineProvider([...configuredProviderChain])
  const sourceConfigIds = providerChain
    .map((provider) => provider.source_config_id)
    .filter((id): id is string => Boolean(id))
  const primary = providerChain[0] || ruleEngineProvider(1)
  const nextVersion = current ? current.version + 1 : 1

  const { data, error } = await supabaseAdmin
    .from('model_policies')
    .insert({
      org_id: orgId,
      key: MODEL_POLICY_KEY,
      name: '合同审核默认模型策略',
      version: nextVersion,
      status: 'published',
      is_current: !current,
      provider_chain: providerChain,
      routing_policy: {
        policy_version: 'f012.model-policy.v1',
        strategy: primary.routing?.strategy || 'rule',
        max_pages: primary.routing?.max_pages || 1,
        stage_order: [
          'structured_rules',
          'template_compare',
          'semantic_review',
          'comment_patch_draft',
          'report_summary',
        ],
        stage_provider_strategy: {
          structured_rules: 'rule_engine_first',
          template_compare: 'rule_and_template_snapshot',
          semantic_review: 'first_available_ai_provider_then_rule_fallback',
          comment_patch_draft: 'schema_validated_ai_or_rule_template',
          report_summary: 'same_fact_set_as_comment_patch',
        },
        data_boundary: {
          external_model_contract_text: 'allowed_only_by_published_provider_policy',
          fallback_without_external_model: true,
        },
      },
      timeout_ms: primary.timeout_ms || 45000,
      fallback_policy: {
        policy_version: 'f012.fallback.v1',
        fallback_order: providerChain.map((provider) => provider.profile),
        final_fallback: 'rule_engine',
        on_timeout: 'next_provider_then_rule_fallback',
        on_provider_error: 'next_provider_then_rule_fallback',
        on_schema_error: 'retry_then_rule_fallback',
        max_attempts_per_provider: 1,
        preserve_review_run: true,
      },
      audit_policy: {
        policy_version: 'f012.audit.v1',
        record_invocation: true,
        require_skill_bundle_id: true,
        require_model_policy_id: true,
        record_provider_chain: true,
        record_stage: true,
        record_latency_ms: true,
        required_spans: [
          'structured_rules',
          'template_compare',
          'semantic_review',
          'comment_patch_draft',
          'report_summary',
        ],
        redact_api_key: true,
        persist_request_response_summary_only: true,
      },
      source_config_ids: sourceConfigIds,
      created_by: requestedBy || null,
      published_by: requestedBy || null,
      published_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error) {
    const refetched = await fetchCurrentModelPolicy(orgId)
    if (refetched) return refetched
    throw error
  }

  if (!current) {
    return normalizeModelPolicy(data as ModelPolicyRow)
  }

  const inserted = normalizeModelPolicy(data as ModelPolicyRow)
  const { error: clearError } = await supabaseAdmin
    .from('model_policies')
    .update({ is_current: false })
    .eq('id', current.id)
  if (clearError) {
    return current
  }

  const { data: promoted, error: promoteError } = await supabaseAdmin
    .from('model_policies')
    .update({ is_current: true })
    .eq('id', inserted.id)
    .select('*')
    .single()
  if (promoteError) {
    await supabaseAdmin
      .from('model_policies')
      .update({ is_current: true })
      .eq('id', current.id)
    throw promoteError
  }

  return normalizeModelPolicy(promoted as ModelPolicyRow)
}

export function selectReviewExecutionProvider(
  policy: ContractModelPolicy,
  stage: ModelPolicyStage = 'structured_rules'
): ModelPolicyProvider {
  const candidates = policy.provider_chain.filter((provider) => provider.stages.includes(stage))
  const ruleProvider = policy.provider_chain.find((provider) => (
    provider.provider_kind === 'builtin' && provider.model === 'rule-engine'
  ))
  if (stage === 'structured_rules' || stage === 'rule_fallback') {
    return ruleProvider || candidates[0] || policy.provider_chain[0] || ruleEngineProvider()
  }

  const aiProvider = candidates.find((provider) => provider.provider_kind !== 'builtin')
  return aiProvider || candidates[0] || ruleProvider || policy.provider_chain[0] || ruleEngineProvider()
}

export async function recordModelInvocation(input: InvocationInput) {
  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('model_invocations')
    .insert({
      org_id: input.orgId || null,
      contract_id: input.contractId || null,
      review_id: input.reviewId || null,
      skill_bundle_id: input.skillBundleId || null,
      model_policy_id: input.modelPolicyId || null,
      provider: input.provider,
      model: input.model,
      phase: input.phase || 'contract_review',
      status: input.status || (input.degraded ? 'degraded' : 'completed'),
      degraded: Boolean(input.degraded),
      fallback_reason: input.fallbackReason || null,
      latency_ms: typeof input.latencyMs === 'number' ? Math.max(0, Math.round(input.latencyMs)) : null,
      request_meta: input.requestMeta || {},
      response_meta: input.responseMeta || {},
      error_message: input.errorMessage || null,
      started_at: now,
      completed_at: now,
    })
    .select('id')
    .single()

  if (error) {
    throw error
  }

  return data as { id: string }
}
