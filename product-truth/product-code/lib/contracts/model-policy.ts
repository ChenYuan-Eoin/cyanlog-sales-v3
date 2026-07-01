import { supabaseAdmin } from '@/lib/supabase'
import { listPublishedAIProviders, type PublishedAIProviderConfig } from '@/lib/configs/runtime'

type JsonRecord = Record<string, unknown>

const MODEL_POLICY_KEY = 'CONTRACT_REVIEW_DEFAULT'

export type ModelPolicyProvider = {
  profile: string
  provider_kind: 'openai_compatible' | 'builtin'
  provider: string
  model: string
  level: number
  timeout_ms: number
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

function normalizeProvider(row: PublishedAIProviderConfig): ModelPolicyProvider {
  return {
    profile: String(row.profile || row.key || row.name || 'provider'),
    provider_kind: row.provider_kind || 'openai_compatible',
    provider: row.provider_kind === 'builtin' ? 'builtin' : 'openai-compatible',
    model: row.model || 'unknown',
    level: Number(row.level || 1),
    timeout_ms: Number(row.timeout_ms || 45000),
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
  if (!chain.some((provider) => provider.provider_kind === 'builtin' && provider.model === 'rule-engine')) {
    chain.push(ruleEngineProvider(chain.length + 1))
  }
  return chain.sort((left, right) => left.level - right.level)
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
  if (current) return current

  const providers = await listPublishedAIProviders(orgId).catch(() => [])
  const providerChain = buildProviderChain(providers)
  const sourceConfigIds = providerChain
    .map((provider) => provider.source_config_id)
    .filter((id): id is string => Boolean(id))
  const primary = providerChain[0] || ruleEngineProvider(1)

  const { data, error } = await supabaseAdmin
    .from('model_policies')
    .insert({
      org_id: orgId,
      key: MODEL_POLICY_KEY,
      name: '合同审核默认模型策略',
      version: 1,
      status: 'published',
      is_current: true,
      provider_chain: providerChain,
      routing_policy: {
        strategy: primary.routing?.strategy || 'rule',
        max_pages: primary.routing?.max_pages || 1,
      },
      timeout_ms: primary.timeout_ms || 45000,
      fallback_policy: {
        fallback_order: providerChain.map((provider) => provider.profile),
        final_fallback: 'rule_engine',
        on_schema_error: 'retry_then_rule_fallback',
      },
      audit_policy: {
        record_invocation: true,
        require_skill_bundle_id: true,
        require_model_policy_id: true,
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

  return normalizeModelPolicy(data as ModelPolicyRow)
}

export function selectReviewExecutionProvider(policy: ContractModelPolicy): ModelPolicyProvider {
  const ruleProvider = policy.provider_chain.find((provider) => (
    provider.provider_kind === 'builtin' && provider.model === 'rule-engine'
  ))
  return ruleProvider || policy.provider_chain[0] || ruleEngineProvider()
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
