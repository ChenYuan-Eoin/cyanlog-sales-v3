// AI 服务多级故障容错链
// 运行时顺序：配置中心已发布 AI_CONFIG -> 环境变量默认值 -> 规则引擎 -> 人工建议

import { createHash } from 'node:crypto'
import { createOpenAI } from '@ai-sdk/openai'
import { streamText } from 'ai'
import {
  listPublishedAIConfigBundle,
  type PublishedAIApplicationConfig,
  type PublishedAIProviderConfig,
  type PublishedAIToolPolicyConfig,
} from '@/lib/configs/runtime'
import {
  extractTokenUsage,
  listLatestProviderProbeEvidence,
  recordModelInvocation,
  type LatestProviderProbeEvidence,
  type ModelInvocationRecord,
  type TokenUsage,
} from '@/lib/ai/model-invocations'
import {
  buildFactsOnlyExtractionInstruction,
  buildFactsOnlyExtractionJsonSchema,
  FactsOnlyRuntimeError,
  getFactsOnlyExtractionCoverageNormalizations,
  getFactsOnlyExtractionModelFactNormalizations,
  getFactsOnlyExtractionSourceAnchorNormalizations,
  getFactsOnlyExtractionTrustedContextNormalizations,
  parseFactsOnlyExtraction,
  serializeFactsOnlyExtractionForStage,
  type FactsOnlyExtraction,
} from '@/lib/contracts/deterministic-review-runtime'
import type { PublishedReviewRule } from '@/lib/contracts/review-workbench'
import { getAIProviderRuntimeSignature } from '@/lib/ai/provider-probe'
import { executeRules } from '@/lib/rules/engine'
import { validateAIOutput } from '@/lib/validation/ai-output'

export interface ReviewOptions {
  preferredProvider?: string
  tool?: 'contract_review' | 'contract_compare' | 'contract_draft' | 'tender_parse' | 'rule_translation' | 'comment_patch' | 'report_summary' | string
  capability?: string
  orgId?: string
  contractId?: string
  reviewId?: string
  jobId?: string
  phase?: string
  requestId?: string
  documentFormat?: string
  sensitiveData?: 'local_only' | 'allow_cloud' | 'any'
  skillBundleId?: string
  modelPolicyId?: string
  frozenModelPolicy?: FrozenReviewModelPolicy
  publishedRules?: ReviewRulePromptContext[]
  outputContract?: 'risk_v1' | 'facts_v1'
  deterministicRules?: PublishedReviewRule[]
  chunk?: ReviewChunkContext
}

export interface ReviewRulePromptContext {
  rule_snapshot_id: string
  rule_code: string
  name: string
  description?: string | null
  clause_category?: string | null
  risk_level?: string | null
  review_criteria?: Record<string, unknown>
}

export interface ReviewChunkContext {
  index: number
  total: number
  start: number
  end: number
  hash: string
  page_start?: number | null
  page_end?: number | null
}

export interface FrozenReviewModelPolicyProvider {
  role?: string | null
  level?: number | null
  profile?: string | null
  model: string
  provider_kind?: string | null
  source_config_id?: string | null
  timeout_ms?: number | null
  stages?: string[]
}

export interface FrozenReviewModelPolicy {
  id: string
  version: number
  timeout_ms?: number | null
  provider_chain: FrozenReviewModelPolicyProvider[]
  source_config_ids?: string[]
}

export interface AIProvider {
  id: string
  name: string
  timeout: number
  providerKind: 'openai_compatible' | 'builtin'
  source?: RuntimeProviderSource
  config: PublishedAIProviderConfig
  application?: PublishedAIApplicationConfig
  policy?: PublishedAIToolPolicyConfig
}

export interface SyncReviewResult {
  risks: Array<{
    level: 'red' | 'yellow' | 'green'
    title: string
    description: string
    suggestion: string
    source_quote?: string | null
    rule_code?: string | null
    rule_snapshot_id?: string | null
  }>
  summary: string
  provider: string
  degraded: boolean
  usage?: TokenUsage
}

export interface SyncFactExtractionResult {
  extraction: FactsOnlyExtraction
  /** Exact provider bytes used for the invocation response hash and staging RPC. */
  rawOutput: string
  provider: string
  degraded: false
  usage: TokenUsage
  invocationId: string
}

export interface SuccessfulFactExtractionEvidence {
  provider: string
  providerKind: 'openai_compatible'
  providerName: string
  model: string
  fallbackRank: number
  attempt: number
  usage: TokenUsage
  latencyMs: number
  requestId?: string
  requestMetadata: Record<string, unknown>
  responseMetadata: Record<string, unknown>
  rawOutput: string
}

export type FactsOnlyReviewOptions = ReviewOptions & {
  deterministicRules: PublishedReviewRule[]
  orgId: string
  contractId: string
  reviewId: string
  jobId: string
  skillBundleId: string
  modelPolicyId: string
  chunk: ReviewChunkContext
  prepareSuccessfulExtraction: (
    extraction: FactsOnlyExtraction,
  ) => FactsOnlyExtraction | Promise<FactsOnlyExtraction>
  persistSuccessfulExtraction: (
    evidence: SuccessfulFactExtractionEvidence,
  ) => Promise<{ invocationId: string }>
}

interface HealthRecord {
  healthy: boolean
  checkedAt: number
}

type RuntimeProviderSource = 'published_config' | 'environment_default'

interface ProviderConfigBundle {
  source: RuntimeProviderSource
  hasPublishedConfigs: boolean
  hasStructuredConfigs: boolean
  configs: PublishedAIProviderConfig[]
  applications: PublishedAIApplicationConfig[]
  toolPolicies: PublishedAIToolPolicyConfig[]
}

export interface ProviderRuntimeReadiness {
  id: string
  name: string
  source: RuntimeProviderSource
  providerKind: AIProvider['providerKind']
  profile?: string
  level: number
  model: string
  baseUrl?: string
  hasApiKey: boolean
  status: 'ready' | 'needs_probe' | 'unavailable' | 'misconfigured' | 'rule_engine'
  blockingReasons: string[]
  warnings: string[]
  boundApps: string[]
  capabilities: string[]
  fallbackChain: string[]
  policyKey?: string
  applicationKey?: string
  lastProbe?: LatestProviderProbeEvidence
}

export interface AIRuntimeReadiness {
  source: RuntimeProviderSource
  hasPublishedConfigs: boolean
  tool: string
  capability: string
  selectedProvider: string | null
  providerChain: string[]
  policyKey: string | null
  policyName: string | null
  applicationKey: string | null
  strategy: string | null
  routingMode: 'structured_policy' | 'legacy_provider_inference' | 'environment_default'
  providers: ProviderRuntimeReadiness[]
  generatedAt: string
}

export function resolvePreferredProviderId(
  readiness: Pick<AIRuntimeReadiness, 'providers'>,
  reference?: string
): string | undefined {
  const needle = reference?.trim().toLowerCase()
  if (!needle) return undefined

  const provider = readiness.providers.find((candidate) => {
    if (candidate.id.toLowerCase() === needle) return true
    if (needle === 'local') {
      return candidate.providerKind === 'openai_compatible'
        && Boolean(candidate.baseUrl && isLocalEndpoint(candidate.baseUrl))
    }
    if (needle === 'cloud') {
      return candidate.providerKind === 'openai_compatible'
        && Boolean(candidate.baseUrl && !isLocalEndpoint(candidate.baseUrl))
    }
    if (needle === 'rule-engine') {
      return candidate.providerKind === 'builtin'
    }
    return false
  })

  return provider?.id
}

const HEALTH_CACHE_TTL = 60_000
const PROVIDER_PROBE_TTL = 24 * 60 * 60 * 1000
const PROMPT_CATALOG_VERSION = 'compact-v2'
const MODEL_OUTPUT_TRUNCATED = 'model_output_truncated'
const HEALTH_CACHE = new Map<string, HealthRecord>()

function normalizeOptions(options?: string | ReviewOptions): ReviewOptions {
  return typeof options === 'string'
    ? { preferredProvider: options }
    : (options || {})
}

function reviewExecutionMetadata(options: ReviewOptions) {
  const compactCatalog = compactPublishedRulesForPrompt(options.publishedRules || [])
  const compactCatalogJson = JSON.stringify(compactCatalog)
  return {
    frozen_rule_count: options.publishedRules?.length || 0,
    prompt_catalog_version: PROMPT_CATALOG_VERSION,
    prompt_rule_count: compactCatalog.length,
    prompt_catalog_char_count: compactCatalogJson.length,
    prompt_catalog_sha256: createHash('sha256').update(compactCatalogJson).digest('hex'),
    frozen_model_policy_id: options.frozenModelPolicy?.id || null,
    frozen_model_policy_version: options.frozenModelPolicy?.version ?? null,
    output_contract: options.outputContract || 'risk_v1',
    ...(options.chunk ? {
      chunk_index: options.chunk.index,
      chunk_total: options.chunk.total,
      chunk_start: options.chunk.start,
      chunk_end: options.chunk.end,
      chunk_hash: options.chunk.hash,
      chunk_page_start: options.chunk.page_start ?? null,
      chunk_page_end: options.chunk.page_end ?? null,
    } : {}),
  }
}

function estimatePageCount(text: string): number {
  const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
  const englishWords = text.split(/\s+/).filter((word) => /^[a-zA-Z]+$/.test(word)).length
  return Math.max(1, Math.ceil(chineseChars / 500 + englishWords / 300))
}

function toList(value: string[] | undefined): string[] {
  return Array.isArray(value)
    ? value.map((entry) => entry.toLowerCase()).filter(Boolean)
    : []
}

function inferTool(options: ReviewOptions): string {
  if (options.tool) {
    return options.tool
  }
  const phase = (options.phase || '').toLowerCase()
  if (phase.includes('compare')) return 'contract_compare'
  if (phase.includes('draft') || phase.includes('generate')) return 'contract_draft'
  if (phase.includes('rule')) return 'rule_translation'
  if (phase.includes('comment')) return 'comment_patch'
  if (phase.includes('summary') || phase.includes('report')) return 'report_summary'
  if (phase.includes('tender') || phase.includes('long_document')) return 'tender_parse'
  return 'contract_review'
}

function inferCapability(tool: string, options: ReviewOptions): string {
  if (options.capability) {
    return options.capability
  }
  switch (tool) {
    case 'contract_compare':
    case 'contract_draft':
    case 'tender_parse':
      return 'long_text'
    case 'rule_translation':
      return 'rule_translation'
    case 'comment_patch':
      return 'comment_patch'
    case 'report_summary':
      return 'report_summary'
    default:
      return 'contract_review'
  }
}

function isLocalEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    return ['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname)
  } catch {
    return false
  }
}

function providerModelListIncludes(payload: unknown, expectedModel: string): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const record = payload as Record<string, unknown>
  const entries = [record.data, record.models]
    .filter(Array.isArray)
    .flat() as unknown[]
  const modelIds = entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const model = entry as Record<string, unknown>
    return [model.id, model.name, model.model, ...(Array.isArray(model.aliases) ? model.aliases : [])]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .map((value) => value.trim())
  })
  return modelIds.includes(expectedModel.trim())
}

export function providerModelListIncludesForTest(payload: unknown, expectedModel: string): boolean {
  return providerModelListIncludes(payload, expectedModel)
}

async function isProviderHealthy(provider: AIProvider): Promise<boolean> {
  if (provider.providerKind !== 'openai_compatible' || !isLocalEndpoint(provider.config.base_url)) {
    return true
  }

  const now = Date.now()
  const cached = HEALTH_CACHE.get(provider.id)
  if (cached && now - cached.checkedAt < HEALTH_CACHE_TTL) {
    return cached.healthy
  }

  try {
    const base = provider.config.base_url.endsWith('/') ? provider.config.base_url : `${provider.config.base_url}/`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    const headers: HeadersInit = {}
    if (provider.config.api_key) {
      headers.Authorization = `Bearer ${provider.config.api_key}`
    }
    const res = await fetch(new URL('models', base), { signal: controller.signal, headers })
    clearTimeout(timeout)
    const payload = res.ok ? await res.json().catch(() => null) : null
    const healthy = res.ok && providerModelListIncludes(payload, provider.config.model)
    HEALTH_CACHE.set(provider.id, { healthy, checkedAt: now })
    return healthy
  } catch {
    HEALTH_CACHE.set(provider.id, { healthy: false, checkedAt: now })
    return false
  }
}

function markProviderUnhealthy(providerId: string): void {
  HEALTH_CACHE.set(providerId, { healthy: false, checkedAt: Date.now() })
}

function getDefaultProviders(): PublishedAIProviderConfig[] {
  return [
    {
      config_id: 'env-local',
      key: 'AI_LOCAL_PRIMARY',
      instance_id: 'local_primary',
      display_name: '本地模型',
      level: 1,
      name: '本地模型',
      profile: 'local_primary',
      provider_kind: 'lm_studio',
      base_url: process.env.LOCAL_MODEL_URL || 'http://localhost:1234/v1',
      api_key: process.env.LOCAL_MODEL_API_KEY,
      model: process.env.LOCAL_MODEL_NAME || 'openai/gpt-oss-20b',
      timeout_ms: 45_000,
      enabled: true,
      routing: { max_pages: 15, strategy: 'full' },
      capabilities: ['contract_review', 'rule_semantic_eval', 'contract_chat', 'comment_patch', 'report_summary'],
      bound_apps: ['contract_review', 'comment_patch', 'report_summary'],
      fallback_chain: ['sales_cloud_backup', 'rule_engine'],
    },
    {
      config_id: 'env-cloud',
      key: 'AI_SALES_CLOUD_BACKUP',
      instance_id: 'sales_cloud_backup',
      display_name: '销售云端模型',
      level: 2,
      name: '销售云端模型',
      profile: 'sales_cloud_backup',
      provider_kind: 'openai_compatible',
      base_url: process.env.AI_GATEWAY_URL || 'https://cloud.yiyongai.cn/v1',
      api_key: process.env.AI_GATEWAY_API_KEY,
      model: process.env.AI_MODEL || 'claude-sonnet-4-6',
      timeout_ms: 20_000,
      enabled: true,
      routing: { max_pages: 80, strategy: 'chunked' },
      capabilities: ['contract_review', 'long_text', 'contract_draft', 'contract_chat', 'contract_compare', 'rule_translation'],
      bound_apps: ['contract_review', 'contract_draft', 'contract_compare', 'tender_parse', 'rule_translation'],
      fallback_chain: ['rule_engine'],
    },
    {
      config_id: 'env-rule',
      key: 'AI_RULE_FALLBACK',
      instance_id: 'rule_engine',
      display_name: '规则引擎',
      level: 3,
      name: '规则引擎',
      profile: 'rule_engine',
      provider_kind: 'builtin',
      base_url: '',
      api_key: undefined,
      model: 'rule-engine',
      timeout_ms: 1_000,
      enabled: true,
      routing: { max_pages: 999, strategy: 'rule' },
      capabilities: ['deterministic_rule_scan'],
      bound_apps: ['contract_compare', 'rule_translation'],
    },
  ]
}

function getRuntimeProviderKind(config: PublishedAIProviderConfig): AIProvider['providerKind'] {
  if (config.provider_kind === 'builtin' || config.provider_kind === 'rule_engine' || config.model === 'rule-engine') {
    return 'builtin'
  }
  return 'openai_compatible'
}

async function loadProviderConfigBundle(orgId?: string): Promise<ProviderConfigBundle> {
  const published = orgId ? await listPublishedAIConfigBundle(orgId).catch(() => null) : null
  if (published?.hasPublishedConfigs) {
    return {
      source: 'published_config',
      hasPublishedConfigs: true,
      hasStructuredConfigs: published.hasStructuredConfigs,
      configs: published.providers,
      applications: published.applications,
      toolPolicies: published.toolPolicies,
    }
  }

  return {
    source: 'environment_default',
    hasPublishedConfigs: false,
    hasStructuredConfigs: false,
    configs: getDefaultProviders(),
    applications: [],
    toolPolicies: [],
  }
}

function toRuntimeProviders(
  bundle: ProviderConfigBundle,
  application?: PublishedAIApplicationConfig,
  policy?: PublishedAIToolPolicyConfig
): AIProvider[] {
  return bundle.configs
    .filter((config) => config.enabled)
    .sort((left, right) => left.level - right.level)
    .map((config) => ({
      id: config.instance_id,
      name: config.profile || config.name || config.instance_id,
      timeout: policy?.timeout_ms || config.timeout_ms,
      providerKind: getRuntimeProviderKind(config),
      source: bundle.source,
      config,
      application,
      policy,
    }))
}

function policyMatchesRequest(
  policy: PublishedAIToolPolicyConfig,
  contractText: string,
  options: ReviewOptions
): boolean {
  const tool = inferTool(options).toLowerCase()
  const capability = inferCapability(tool, options).toLowerCase()
  if (policy.tool.toLowerCase() !== tool && policy.tool !== '*') return false
  if (policy.capability.toLowerCase() !== capability && policy.capability !== '*') return false

  const conditions = policy.conditions
  if (!conditions) return true
  const chars = contractText.length
  const pages = estimatePageCount(contractText)
  if (conditions.min_chars !== undefined && chars < conditions.min_chars) return false
  if (conditions.max_chars !== undefined && chars > conditions.max_chars) return false
  if (conditions.min_pages !== undefined && pages < conditions.min_pages) return false
  if (conditions.max_pages !== undefined && pages > conditions.max_pages) return false
  if (conditions.document_formats?.length && options.documentFormat) {
    const formats = conditions.document_formats.map((entry) => entry.toLowerCase())
    if (!formats.includes(options.documentFormat.toLowerCase())) return false
  }
  if (conditions.sensitive_data && conditions.sensitive_data !== 'any') {
    if ((options.sensitiveData || 'any') !== conditions.sensitive_data) return false
  }
  return true
}

function selectToolPolicy(
  bundle: ProviderConfigBundle,
  contractText: string,
  options: ReviewOptions
): PublishedAIToolPolicyConfig | undefined {
  return bundle.toolPolicies
    .filter((policy) => policy.enabled && policyMatchesRequest(policy, contractText, options))
    .sort((left, right) => left.priority - right.priority)[0]
}

function selectApplication(
  bundle: ProviderConfigBundle,
  policy: PublishedAIToolPolicyConfig | undefined,
  options: ReviewOptions
): PublishedAIApplicationConfig | undefined {
  if (policy?.application_key) {
    const exact = bundle.applications.find((application) => [
      application.key,
      application.application_id,
    ].includes(policy.application_key))
    if (exact) return exact
  }

  const tool = inferTool(options).toLowerCase()
  const capability = inferCapability(tool, options).toLowerCase()
  return bundle.applications.find((application) => {
    const tools = toList(application.bound_tools)
    const capabilities = toList(application.capabilities)
    return tools.includes(tool) || capabilities.includes(capability)
  })
}

function buildStructuredProviderChain(
  providers: AIProvider[],
  policy: PublishedAIToolPolicyConfig,
  options: ReviewOptions
): AIProvider[] {
  const orderedReferences = [...policy.provider_chain, ...(policy.fallback_chain || [])]
  const chain: AIProvider[] = []

  if (options.preferredProvider) {
    const preferred = providers.find((provider) => matchesProvider(provider, options.preferredProvider!))
    if (preferred) chain.push(preferred)
  }

  for (const reference of orderedReferences) {
    const provider = providers.find((candidate) => (
      !chain.some((entry) => entry.id === candidate.id)
      && providerReferenceMatches(candidate, reference)
    ))
    if (provider) chain.push(provider)
  }

  return chain
}

function normalizeProviderKind(kind: string | null | undefined) {
  return ['builtin', 'rule_engine'].includes((kind || '').toLowerCase())
    ? 'builtin'
    : 'openai_compatible'
}

function buildFrozenProviderChain(
  providers: AIProvider[],
  policy: FrozenReviewModelPolicy,
  options: ReviewOptions
): AIProvider[] {
  if (options.modelPolicyId && options.modelPolicyId !== policy.id) {
    throw new Error('ReviewRun 模型策略 ID 与冻结策略不一致，已停止执行')
  }
  const phase = options.phase || 'semantic_review'
  const applicable = policy.provider_chain
    .filter((entry) => !entry.stages?.length || entry.stages.includes(phase))
    .sort((left, right) => (left.level ?? Number.MAX_SAFE_INTEGER) - (right.level ?? Number.MAX_SAFE_INTEGER))
  if (applicable.length === 0) {
    throw new Error(`冻结模型策略未授权阶段 ${phase}，已停止执行`)
  }

  const chain = applicable.map((entry) => {
    const expectedKind = normalizeProviderKind(entry.provider_kind)
    const provider = entry.source_config_id
      ? providers.find((candidate) => candidate.config.config_id === entry.source_config_id)
      : providers.find((candidate) => (
          candidate.providerKind === 'builtin'
          && candidate.config.model === entry.model
        ))
    if (!provider) {
      throw new Error(`冻结模型策略 Provider ${entry.profile || entry.source_config_id || entry.model} 当前不可用，已停止执行`)
    }
    if (
      provider.providerKind !== expectedKind
      || provider.config.model !== entry.model
      || (entry.profile && ![
        provider.id,
        provider.config.instance_id,
        provider.config.profile,
      ].includes(entry.profile))
    ) {
      throw new Error(`冻结模型策略 Provider ${entry.profile || entry.model} 的配置或模型已漂移，已停止执行`)
    }
    return {
      ...provider,
      timeout: entry.timeout_ms || policy.timeout_ms || provider.timeout,
    }
  })

  if (!options.preferredProvider) return chain
  const preferred = chain.find((provider) => matchesProvider(provider, options.preferredProvider!))
  return preferred
    ? [preferred, ...chain.filter((provider) => provider.id !== preferred.id)]
    : chain
}

export function resolveFrozenProviderChainForTest(
  providers: AIProvider[],
  policy: FrozenReviewModelPolicy,
  options: ReviewOptions = {}
) {
  return buildFrozenProviderChain(providers, policy, options).map((provider) => provider.id)
}

interface RuntimeProviderSelection {
  bundle: ProviderConfigBundle
  providers: AIProvider[]
  policy?: PublishedAIToolPolicyConfig
  application?: PublishedAIApplicationConfig
}

async function loadRuntimeProviderSelection(
  orgId: string | undefined,
  contractText: string,
  options: ReviewOptions
): Promise<RuntimeProviderSelection> {
  const bundle = await loadProviderConfigBundle(orgId)
  const policy = selectToolPolicy(bundle, contractText, options)
  const application = selectApplication(bundle, policy, options)
  const providers = toRuntimeProviders(bundle, application, policy)

  if (options.frozenModelPolicy) {
    return {
      bundle,
      policy,
      application,
      providers: buildFrozenProviderChain(providers, options.frozenModelPolicy, options),
    }
  }

  if (bundle.hasStructuredConfigs) {
    return {
      bundle,
      policy,
      application,
      providers: policy ? buildStructuredProviderChain(providers, policy, options) : [],
    }
  }

  return {
    bundle,
    policy,
    application,
    providers: buildProviderChain(providers, contractText, options),
  }
}

export function describeProviderRuntimeReadiness(
  provider: AIProvider,
  lastProbe?: LatestProviderProbeEvidence,
  now = Date.now()
): ProviderRuntimeReadiness {
  const blockingReasons: string[] = []
  const warnings: string[] = []
  const config = provider.config
  const baseUrl = typeof config.base_url === 'string' ? config.base_url.trim() : ''
  const model = typeof config.model === 'string' ? config.model.trim() : ''
  const hasApiKey = typeof config.api_key === 'string' && config.api_key.trim().length > 0
  const localEndpoint = baseUrl ? isLocalEndpoint(baseUrl) : false

  if (!config.enabled) {
    blockingReasons.push('provider_disabled')
  }

  if (provider.providerKind === 'builtin' || model === 'rule-engine') {
    return {
      id: provider.id,
      name: provider.name,
      source: provider.source || 'published_config',
      providerKind: provider.providerKind,
      profile: config.profile,
      level: config.level,
      model: model || 'rule-engine',
      baseUrl: baseUrl || undefined,
      hasApiKey: false,
      status: 'rule_engine',
      blockingReasons,
      warnings: ['rule_engine_is_deterministic_fallback_not_ai_model'],
      boundApps: config.bound_apps || [],
      capabilities: config.capabilities || [],
      fallbackChain: config.fallback_chain || [],
      policyKey: provider.policy?.key,
      applicationKey: provider.application?.key,
      lastProbe,
    }
  }

  if (!baseUrl) {
    blockingReasons.push('missing_base_url')
  }
  if (!model) {
    blockingReasons.push('missing_model')
  }
  if (!hasApiKey) {
    if (localEndpoint) {
      warnings.push('missing_api_key_probe_required')
    } else {
      blockingReasons.push('missing_api_key')
    }
  }

  const expectedSignature = getAIProviderRuntimeSignature(config)
  let status: ProviderRuntimeReadiness['status'] = 'needs_probe'

  if (blockingReasons.length > 0) {
    status = 'misconfigured'
  } else if (!lastProbe) {
    warnings.push('inference_probe_required')
  } else if (lastProbe.runtimeSignature !== expectedSignature || lastProbe.model !== model) {
    warnings.push('inference_probe_config_mismatch')
  } else {
    const checkedAt = Date.parse(lastProbe.checkedAt)
    if (!Number.isFinite(checkedAt) || now - checkedAt > PROVIDER_PROBE_TTL) {
      warnings.push('inference_probe_stale')
    } else if (lastProbe.status === 'completed') {
      status = 'ready'
    } else {
      status = 'unavailable'
      warnings.push('inference_probe_failed')
    }
  }

  return {
    id: provider.id,
    name: provider.name,
    source: provider.source || 'published_config',
    providerKind: provider.providerKind,
    profile: config.profile,
    level: config.level,
    model,
    baseUrl: baseUrl || undefined,
    hasApiKey,
    status,
    blockingReasons,
    warnings,
    boundApps: config.bound_apps || [],
    capabilities: config.capabilities || [],
    fallbackChain: config.fallback_chain || [],
    policyKey: provider.policy?.key,
    applicationKey: provider.application?.key,
    lastProbe,
  }
}

export async function getAIRuntimeReadiness(
  orgId?: string,
  options: ReviewOptions = {}
): Promise<AIRuntimeReadiness> {
  const tool = inferTool(options)
  const capability = inferCapability(tool, options)
  const selection = await loadRuntimeProviderSelection(orgId, 'ONES runtime readiness sample', options)
  const configuredProviders = toRuntimeProviders(
    selection.bundle,
    selection.application,
    selection.policy
  )
  const probeEvidence = orgId
    ? await listLatestProviderProbeEvidence(orgId)
    : new Map<string, LatestProviderProbeEvidence>()

  return {
    source: selection.bundle.source,
    hasPublishedConfigs: selection.bundle.hasPublishedConfigs,
    tool,
    capability,
    selectedProvider: selection.providers[0]?.id || null,
    providerChain: selection.providers.map((provider) => provider.id),
    policyKey: selection.policy?.key || null,
    policyName: selection.policy?.name || null,
    applicationKey: selection.application?.key || null,
    strategy: selection.policy?.strategy || null,
    routingMode: selection.bundle.source === 'environment_default'
      ? 'environment_default'
      : selection.bundle.hasStructuredConfigs
        ? 'structured_policy'
        : 'legacy_provider_inference',
    providers: configuredProviders.map((provider) => {
      const evidence = probeEvidence.get(provider.id)
        || probeEvidence.get(provider.config.key)
        || (provider.config.profile ? probeEvidence.get(provider.config.profile) : undefined)
      return describeProviderRuntimeReadiness(provider, evidence)
    }),
    generatedAt: new Date().toISOString(),
  }
}

function matchesProvider(provider: AIProvider, preferredProvider: string): boolean {
  const needle = preferredProvider.toLowerCase()
  if (needle === 'local') {
    return provider.providerKind === 'openai_compatible' && isLocalEndpoint(provider.config.base_url)
  }
  if (needle === 'cloud') {
    return provider.providerKind === 'openai_compatible' && !isLocalEndpoint(provider.config.base_url)
  }
  if (needle === 'rule-engine') {
    return provider.providerKind === 'builtin'
  }
  return [
    provider.id,
    provider.name,
    provider.config.key,
    provider.config.instance_id,
    provider.config.profile,
    provider.config.display_name,
    provider.config.name,
    provider.config.model,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .some((value) => value.toLowerCase() === needle)
}

function providerReferenceMatches(provider: AIProvider, reference: string): boolean {
  return matchesProvider(provider, reference)
}

function getRoutingScore(
  provider: AIProvider,
  options: ReviewOptions,
  pageCount: number
): number {
  const tool = inferTool(options).toLowerCase()
  const capability = inferCapability(tool, options).toLowerCase()
  const apps = toList(provider.config.bound_apps)
  const capabilities = toList(provider.config.capabilities)
  const strategy = provider.config.routing?.strategy || 'full'
  let score = 100 - provider.config.level

  if (apps.length > 0) {
    score += apps.includes(tool) ? 80 : -45
  } else {
    score += 10
  }

  if (capabilities.length > 0) {
    score += capabilities.includes(capability) ? 50 : -25
  } else {
    score += 8
  }

  if (provider.providerKind !== 'builtin') {
    const maxPages = provider.config.routing?.max_pages
    if (typeof maxPages === 'number') {
      score += pageCount <= maxPages ? 20 : -30
    }
  }

  if (strategy === 'local_first' && isLocalEndpoint(provider.config.base_url)) score += 18
  if (strategy === 'quality_first' && provider.providerKind !== 'builtin' && !isLocalEndpoint(provider.config.base_url)) score += 18
  if (strategy === 'cost_first' && (isLocalEndpoint(provider.config.base_url) || provider.providerKind === 'builtin')) score += 12
  if (strategy === 'compliance_first' && (isLocalEndpoint(provider.config.base_url) || provider.providerKind === 'builtin')) score += 18
  if (strategy === 'rule' && provider.providerKind === 'builtin') score += 40
  if (strategy === 'chunked' && pageCount > 15 && provider.providerKind !== 'builtin') score += 16
  if (provider.providerKind === 'builtin' && capability !== 'deterministic_rule_scan') score -= 40

  return score
}

function pickStartProvider(
  providers: AIProvider[],
  contractText: string,
  options: ReviewOptions
): AIProvider | undefined {
  if (options.preferredProvider) {
    return providers.find((provider) => matchesProvider(provider, options.preferredProvider!))
  }

  const pageCount = estimatePageCount(contractText)
  return providers
    .map((provider) => ({
      provider,
      score: getRoutingScore(provider, options, pageCount),
    }))
    .sort((left, right) => right.score - left.score)
    [0]?.provider
}

function buildProviderChain(providers: AIProvider[], contractText: string, options: ReviewOptions): AIProvider[] {
  if (providers.length === 0) {
    return []
  }

  const startProvider = pickStartProvider(providers, contractText, options)
  if (!startProvider) {
    return []
  }

  const chain: AIProvider[] = [startProvider]
  const fallbackRefs = startProvider.config.fallback_chain || []
  for (const reference of fallbackRefs) {
    const fallback = providers.find((provider) => (
      provider.id !== startProvider.id
      && !chain.some((entry) => entry.id === provider.id)
      && providerReferenceMatches(provider, reference)
    ))
    if (fallback) {
      chain.push(fallback)
    }
  }

  for (const provider of providers) {
    if (!chain.some((entry) => entry.id === provider.id)) {
      chain.push(provider)
    }
  }

  return chain
}

export function resolveProviderChainForTest(
  providers: AIProvider[],
  contractText: string,
  options: ReviewOptions = {}
): string[] {
  return buildProviderChain(providers, contractText, options).map((provider) => provider.id)
}

export function resolveStructuredProviderChainForTest(
  providers: AIProvider[],
  policy: PublishedAIToolPolicyConfig,
  contractText: string,
  options: ReviewOptions = {}
): { matches: boolean; chain: string[] } {
  return {
    matches: policyMatchesRequest(policy, contractText, options),
    chain: buildStructuredProviderChain(providers, policy, options).map((provider) => provider.id),
  }
}

function truncateTextForProvider(contractText: string, provider: AIProvider): string {
  const inputLimit = isLocalEndpoint(provider.config.base_url) ? 4000 : 8000
  return contractText.substring(0, inputLimit)
}

/**
 * Rule snapshots retain the full authored semantic prompt for audit, but the
 * runtime catalogue must not repeat that prompt when a concise description is
 * already present. The v21 snapshots encode the same thresholds in both
 * fields; sending both consumed almost the entire 8K local context and left no
 * room for a valid JSON response.
 *
 * Keep immutable rule identities and structured detection hints. Fall back to
 * semantic_prompt only for older snapshots that have no usable description.
 */
function compactPublishedRulesForPrompt(
  publishedRules: ReviewRulePromptContext[]
): Array<Record<string, unknown>> {
  return publishedRules.map((rule) => {
    const description = rule.description?.trim() || null
    const criteria = rule.review_criteria && typeof rule.review_criteria === 'object'
      ? rule.review_criteria
      : {}
    const semanticPrompt = typeof criteria.semantic_prompt === 'string'
      ? criteria.semantic_prompt.trim()
      : ''
    const compactCriteria = Object.fromEntries(Object.entries(criteria).filter(([key, value]) => (
      key !== 'semantic_prompt'
      && key !== 'engine_type'
      && key !== 'category'
      && value !== null
      && value !== undefined
      && value !== ''
      && (!Array.isArray(value) || value.length > 0)
    )))
    if (!description && semanticPrompt) {
      compactCriteria.semantic_prompt = semanticPrompt
    }

    return {
      rule_code: rule.rule_code,
      name: rule.name,
      ...(description ? { description } : {}),
      ...(rule.clause_category ? { clause_category: rule.clause_category } : {}),
      ...(rule.risk_level ? { risk_level: rule.risk_level } : {}),
      ...(Object.keys(compactCriteria).length > 0 ? { review_criteria: compactCriteria } : {}),
    }
  })
}

const REVIEW_OUTPUT_CONTRACT = `输出协议（必须遵守）：
1. 只输出一个 JSON 对象，不得输出 Markdown、代码围栏、思考过程、解释或前后缀。
2. JSON 必须严格符合以下结构：
{
  "risks": [
    {
      "level": "red|yellow|green",
      "title": "简短风险标题",
      "description": "基于合同原文的问题说明",
      "suggestion": "可执行的处理建议",
      "source_quote": "从输入合同逐字复制、足以定位该风险的连续原文",
      "rule_code": "仅当冻结规则目录明确给出且确实命中时逐字填写；否则为 null",
      "rule_snapshot_id": null
    }
  ],
  "summary": "总体评估摘要"
}
3. risks 必须是数组；没有风险时返回空数组。level 只能是 red、yellow、green 之一。
4. 每条局部风险都必须提供非空 source_quote，且必须与输入合同逐字一致，不得加空格、改写、归一化或补字；无法逐字引用时不要输出该风险。
5. rule_code 只能逐字复制冻结规则目录中的 code；rule_snapshot_id 始终返回 null，由服务端从本 ReviewRun 的冻结 bundle 唯一派生，禁止模型复制或猜测 UUID。
6. 规则摘要中的 A/Level A/可接受表示不生成风险；B/Level B/可让步输出 yellow；C/Level C/红线输出 red。证据不足以确定红线时最多输出 yellow，不得自行升级 red。
7. 同一原文同时看似命中宽泛规则和更具体的领域规则时，只输出 target_field/clause_category 最贴合条款主题的规则，避免重复风险。
8. 不得虚构合同中不存在的事实。`

function buildSystemPrompt(
  provider: AIProvider,
  attempt: number = 0,
  publishedRules: ReviewRulePromptContext[] = [],
  outputContract: ReviewOptions['outputContract'] = 'risk_v1',
  deterministicRules: PublishedReviewRule[] = [],
): string {
  const repairInstruction = attempt > 0
    ? '\n\n上一次响应没有通过结构校验。请重新生成，并严格只返回符合输出协议的 JSON 对象。'
    : ''
  if (outputContract === 'facts_v1') {
    if (deterministicRules.length === 0) {
      throw new Error('facts_v1 requires frozen deterministic rules')
    }
    return [
      '你是合同事实抽取器。你没有风险定级权限，只能逐字引用原文并填写冻结 schema 允许的事实。',
      buildFactsOnlyExtractionInstruction(deterministicRules),
      repairInstruction,
    ].join('\n\n')
  }

  const configuredPrompt = provider.application?.system_prompt?.trim()
    || provider.config.system_prompt?.trim()
  const rolePrompt = configuredPrompt || (isLocalEndpoint(provider.config.base_url)
    ? '你是法务合同审核助手。请依据已发布规则识别合同风险。'
    : '你是一位专业的法务合同审核专家。请依据已发布规则分析合同内容并识别风险。')
  const frozenRuleContext = publishedRules.length > 0
    ? `\n\n冻结规则目录（这是本次 ReviewRun 唯一允许引用的规则事实；模型只返回其中的 rule_code，服务端负责绑定冻结 snapshot）：\n${JSON.stringify(compactPublishedRulesForPrompt(publishedRules))}`
    : '\n\n本次未提供冻结规则目录；所有风险的 rule_code 与 rule_snapshot_id 必须均为 null。'

  return `${rolePrompt}\n\n${REVIEW_OUTPUT_CONTRACT}${frozenRuleContext}${repairInstruction}`
}

export function buildReviewSystemPromptForTest(
  provider: AIProvider,
  attempt: number = 0,
  publishedRules: ReviewRulePromptContext[] = []
): string {
  return buildSystemPrompt(provider, attempt, publishedRules)
}

export function buildFactsOnlySystemPromptForTest(
  provider: AIProvider,
  deterministicRules: PublishedReviewRule[],
  attempt: number = 0,
): string {
  return buildSystemPrompt(provider, attempt, [], 'facts_v1', deterministicRules)
}

function getChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '')
  if (normalized.endsWith('/v1') || normalized.includes('/v1/')) {
    return `${normalized}/chat/completions`
  }
  return `${normalized}/v1/chat/completions`
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') {
    return content
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { text: unknown }).text
          if (typeof text === 'string') return text
          if (text && typeof text === 'object' && 'value' in text) {
            return String((text as { value: unknown }).value)
          }
        }
        if (part && typeof part === 'object' && 'output_text' in part) {
          return String((part as { output_text: unknown }).output_text)
        }
        return ''
      })
      .join('')
  }
  if (content && typeof content === 'object' && 'text' in content) {
    return contentToText((content as { text: unknown }).text)
  }
  return ''
}

function getResponseText(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return ''
  }
  const outputText = contentToText((payload as { output_text?: unknown }).output_text)
  if (outputText) {
    return outputText
  }
  const output = (payload as { output?: unknown }).output
  if (Array.isArray(output)) {
    const responseText = output
      .map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return ''
        return contentToText((item as { content?: unknown }).content)
          || contentToText((item as { text?: unknown }).text)
      })
      .join('')
    if (responseText) {
      return responseText
    }
  }
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return ''
  }
  const first = choices[0]
  if (!first || typeof first !== 'object') {
    return ''
  }
  const message = (first as { message?: unknown }).message
  if (message && typeof message === 'object' && !Array.isArray(message)) {
    return contentToText((message as { content?: unknown }).content)
      || contentToText((message as { reasoning_content?: unknown }).reasoning_content)
  }
  return contentToText((first as { text?: unknown }).text)
}

export function getProviderResponseTextForTest(payload: unknown): string {
  return getResponseText(payload)
}

function getResponseError(payload: unknown, fallbackText: string): string {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'error' in payload) {
    const error = (payload as { error?: unknown }).error
    if (error && typeof error === 'object' && !Array.isArray(error) && 'message' in error) {
      return String((error as { message?: unknown }).message)
    }
    if (typeof error === 'string') {
      return error
    }
  }
  return fallbackText.slice(0, 500)
}

function getResponseFinishReason(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== 'object') return undefined
  const finishReason = (choices[0] as { finish_reason?: unknown }).finish_reason
  return typeof finishReason === 'string' ? finishReason : undefined
}

export function getProviderFinishReasonForTest(payload: unknown): string | undefined {
  return getResponseFinishReason(payload)
}

interface ProviderCallResult {
  text: string
  usage?: TokenUsage
  latencyMs: number
  requestId?: string
  finishReason?: string
}

function getProviderApiKey(provider: AIProvider): string {
  return typeof provider.config.api_key === 'string' ? provider.config.api_key.trim() : ''
}

function getProviderRequestHeaders(provider: AIProvider): HeadersInit {
  const headers: HeadersInit = { 'Content-Type': 'application/json' }
  const apiKey = getProviderApiKey(provider)
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }
  return headers
}

async function callOpenAICompatibleProvider(
  provider: AIProvider,
  contractText: string,
  attempt: number = 0,
  abortSignal?: AbortSignal,
  options: ReviewOptions = {}
): Promise<ReadableStream> {
  const gateway = createOpenAI({
    baseURL: provider.config.base_url,
    apiKey: getProviderApiKey(provider),
  })

  const result = streamText({
    model: gateway(provider.config.model),
    messages: [
      {
        role: 'system',
        content: buildSystemPrompt(
          provider,
          attempt,
          options.publishedRules,
          options.outputContract,
          options.deterministicRules,
        ),
      },
      {
        role: 'user',
        content: `请审核以下合同：\n\n${truncateTextForProvider(contractText, provider)}`,
      },
    ],
    maxOutputTokens: isLocalEndpoint(provider.config.base_url) ? 2000 : 4000,
    temperature: 0,
    abortSignal,
  })

  return result.toTextStreamResponse().body!
}

function buildSyncResponseFormat(provider: AIProvider, options: ReviewOptions): Record<string, unknown> {
  if (options.outputContract === 'facts_v1') {
    if (!options.deterministicRules?.length) {
      throw new Error('facts_v1 requires frozen deterministic rules')
    }
    return {
      type: 'json_schema',
      json_schema: {
        name: 'contract_review_facts_v1',
        strict: true,
        schema: buildFactsOnlyExtractionJsonSchema(options.deterministicRules),
      },
    }
  }

  const configuredResponseFormat = provider.config.json_config?.response_format
  const frozenRuleCodes = [...new Set((options.publishedRules || []).map((rule) => rule.rule_code).filter(Boolean))]
  const ruleCodeSchema = frozenRuleCodes.length > 0
    ? { type: ['string', 'null'], enum: [...frozenRuleCodes, null] }
    : { type: 'null' }
  if (configuredResponseFormat && typeof configuredResponseFormat === 'object') {
    return configuredResponseFormat as Record<string, unknown>
  }
  return isLocalEndpoint(provider.config.base_url)
    ? {
        type: 'json_schema',
        json_schema: {
          name: 'contract_review_result',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['risks', 'summary'],
            properties: {
              risks: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['level', 'title', 'description', 'suggestion', 'source_quote', 'rule_code', 'rule_snapshot_id'],
                  properties: {
                    level: { type: 'string', enum: ['red', 'yellow', 'green'] },
                    title: { type: 'string' },
                    description: { type: 'string' },
                    suggestion: { type: 'string' },
                    source_quote: { type: 'string', minLength: 4 },
                    rule_code: ruleCodeSchema,
                    rule_snapshot_id: { type: 'null' },
                  },
                },
              },
              summary: { type: 'string' },
            },
          },
        },
      }
    : { type: 'json_object' }
}

export function buildSyncResponseFormatForTest(
  provider: AIProvider,
  options: ReviewOptions,
): Record<string, unknown> {
  return buildSyncResponseFormat(provider, options)
}

async function callOpenAICompatibleProviderSync(
  provider: AIProvider,
  contractText: string,
  attempt: number = 0,
  abortSignal?: AbortSignal,
  options: ReviewOptions = {}
): Promise<ProviderCallResult> {
  const startedAt = Date.now()
  const endpoint = getChatCompletionsUrl(provider.config.base_url)
  const responseFormat = buildSyncResponseFormat(provider, options)
  const requestBody = {
      model: provider.config.model,
      messages: [
        {
          role: 'system',
          content: buildSystemPrompt(
            provider,
            attempt,
            options.publishedRules,
            options.outputContract,
            options.deterministicRules,
          ),
        },
        { role: 'user', content: `请审核以下合同：\n\n${truncateTextForProvider(contractText, provider)}` },
      ],
      temperature: 0,
      max_tokens: isLocalEndpoint(provider.config.base_url) ? 2000 : 4000,
      stream: false,
      response_format: responseFormat,
    }

  const executeRequest = (includeResponseFormat: boolean) => fetch(endpoint, {
    method: 'POST',
    signal: abortSignal,
    headers: getProviderRequestHeaders(provider),
    body: JSON.stringify(includeResponseFormat
      ? requestBody
      : { ...requestBody, response_format: undefined }),
  })

  let response = await executeRequest(true)
  if (!response.ok && [400, 415, 422].includes(response.status)) {
    response = await executeRequest(false)
  }

  const rawText = await response.text()
  let payload: unknown = {}
  try {
    payload = rawText ? JSON.parse(rawText) : {}
  } catch {
    payload = {}
  }

  if (!response.ok) {
    throw new Error(getResponseError(payload, rawText) || `HTTP ${response.status}`)
  }

  const text = getResponseText(payload)
  if (!text) {
    throw new Error('模型响应缺少可解析内容')
  }

  return {
    text,
    usage: extractTokenUsage(payload),
    latencyMs: Date.now() - startedAt,
    requestId: response.headers.get('x-request-id') || response.headers.get('openai-request-id') || undefined,
    finishReason: getResponseFinishReason(payload),
  }
}

async function callRuleEngineProvider(contractText: string, orgId?: string): Promise<ReadableStream> {
  const result = await executeRules(contractText, orgId)
  const encoder = new TextEncoder()
  const chunks = JSON.stringify({
    risks: result.risks.map((risk) => ({ ...risk, source_quote: null })),
    summary: result.summary,
  }).match(/.{1,80}/g) || ['{}']
  let index = 0

  return new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]))
        index += 1
        return
      }
      controller.close()
    },
  })
}

async function callRuleEngineProviderSync(contractText: string, orgId?: string): Promise<ProviderCallResult> {
  const startedAt = Date.now()
  const result = await executeRules(contractText, orgId)
  return {
    text: JSON.stringify({
      risks: result.risks.map((risk) => ({ ...risk, source_quote: null })),
      summary: result.summary,
    }),
    latencyMs: Date.now() - startedAt,
  }
}

async function callProvider(
  provider: AIProvider,
  contractText: string,
  orgId?: string,
  attempt: number = 0,
  abortSignal?: AbortSignal,
  options: ReviewOptions = {}
): Promise<ReadableStream> {
  if (provider.providerKind === 'builtin' || provider.config.model === 'rule-engine') {
    return callRuleEngineProvider(contractText, orgId)
  }

  return callOpenAICompatibleProvider(provider, contractText, attempt, abortSignal, options)
}

async function callProviderSync(
  provider: AIProvider,
  contractText: string,
  orgId?: string,
  attempt: number = 0,
  abortSignal?: AbortSignal,
  options: ReviewOptions = {}
): Promise<ProviderCallResult> {
  if (provider.providerKind === 'builtin' || provider.config.model === 'rule-engine') {
    return callRuleEngineProviderSync(contractText, orgId)
  }

  return callOpenAICompatibleProviderSync(provider, contractText, attempt, abortSignal, options)
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  abortController: AbortController
): Promise<T> {
  const timeout = setTimeout(() => abortController.abort(), timeoutMs)
  try {
    return await promise
  } finally {
    clearTimeout(timeout)
  }
}

type StreamInvocationBase = Omit<ModelInvocationRecord, 'status' | 'latencyMs' | 'error'>

function wrapStreamWithInvocationCompletion(
  stream: ReadableStream,
  baseRecord: StreamInvocationBase,
  startedAt: number
): ReadableStream {
  let reader: ReadableStreamDefaultReader | null = null
  let completed = false

  async function recordCompletion(status: 'succeeded' | 'failed', error?: string) {
    if (completed) return
    completed = true
    await recordModelInvocation({
      ...baseRecord,
      status,
      latencyMs: Date.now() - startedAt,
      error,
      metadata: {
        ...(baseRecord.metadata || {}),
        stream_completed: status === 'succeeded',
      },
    })
  }

  return new ReadableStream({
    async start(controller) {
      reader = stream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          controller.enqueue(value)
        }
        await recordCompletion('succeeded')
        controller.close()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await recordCompletion('failed', message)
        controller.error(error)
      } finally {
        reader.releaseLock()
      }
    },
    async cancel(reason) {
      await reader?.cancel(reason)
      await recordCompletion('failed', reason ? `stream_cancelled: ${String(reason)}` : 'stream_cancelled')
    },
  })
}

export async function reviewWithFailover(
  contractText: string,
  options?: string | ReviewOptions
): Promise<{ stream: ReadableStream; provider: string; degraded: boolean }> {
  const normalizedOptions = normalizeOptions(options)
  if (normalizedOptions.outputContract === 'facts_v1') {
    throw new Error('facts_v1_requires_extractReviewFactsWithFailoverSync')
  }
  const phase = normalizedOptions.phase || 'semantic_review'
  const errors: string[] = []
  const selection = await loadRuntimeProviderSelection(
    normalizedOptions.orgId,
    contractText,
    normalizedOptions
  )
  const providers = selection.providers
  if (selection.bundle.hasStructuredConfigs && !selection.policy) {
    errors.push(`no_matching_tool_policy:${inferTool(normalizedOptions)}:${inferCapability(inferTool(normalizedOptions), normalizedOptions)}`)
  }

  for (const [fallbackRank, provider] of providers.entries()) {
    const tool = inferTool(normalizedOptions)
    const capability = inferCapability(tool, normalizedOptions)
    const metadata = {
      config_id: provider.config.config_id,
      routing: provider.config.routing,
      preferred_provider: normalizedOptions.preferredProvider || null,
      consumer_tool: tool,
      required_capability: capability,
      estimated_page_count: estimatePageCount(contractText),
      configured_fallback_chain: provider.config.fallback_chain || [],
      policy_key: selection.policy?.key || null,
      policy_config_id: selection.policy?.config_id || null,
      policy_strategy: selection.policy?.strategy || null,
      application_key: selection.application?.key || null,
      application_config_id: selection.application?.config_id || null,
      routing_mode: selection.bundle.hasStructuredConfigs ? 'structured_policy' : 'legacy_provider_inference',
      mode: 'stream',
      ...reviewExecutionMetadata(normalizedOptions),
    }

    if (!(await isProviderHealthy(provider))) {
      await recordModelInvocation({
        orgId: normalizedOptions.orgId,
        contractId: normalizedOptions.contractId,
        reviewId: normalizedOptions.reviewId,
        jobId: normalizedOptions.jobId,
        skillBundleId: normalizedOptions.skillBundleId,
        modelPolicyId: normalizedOptions.modelPolicyId,
        phase,
        providerKey: provider.id,
        providerKind: provider.providerKind,
        providerName: provider.config.display_name || provider.name,
        model: provider.config.model,
        status: 'skipped',
        degraded: provider.providerKind === 'builtin',
        fallbackRank,
        latencyMs: 0,
        error: 'provider_unhealthy',
        requestId: normalizedOptions.requestId,
        metadata,
      })
      continue
    }

    const abortController = new AbortController()
    try {
      const startedAt = Date.now()
      const stream = await withTimeout(
        callProvider(provider, contractText, normalizedOptions.orgId, 0, abortController.signal, normalizedOptions),
        provider.timeout,
        abortController
      )

      await recordModelInvocation({
        orgId: normalizedOptions.orgId,
        contractId: normalizedOptions.contractId,
        reviewId: normalizedOptions.reviewId,
        jobId: normalizedOptions.jobId,
        skillBundleId: normalizedOptions.skillBundleId,
        modelPolicyId: normalizedOptions.modelPolicyId,
        phase,
        providerKey: provider.id,
        providerKind: provider.providerKind,
        providerName: provider.config.display_name || provider.name,
        model: provider.config.model,
        status: 'started',
        degraded: provider.providerKind === 'builtin',
        fallbackRank,
        latencyMs: Date.now() - startedAt,
        requestId: normalizedOptions.requestId,
        metadata,
      })

      return {
        stream: wrapStreamWithInvocationCompletion(stream, {
          orgId: normalizedOptions.orgId,
          contractId: normalizedOptions.contractId,
          reviewId: normalizedOptions.reviewId,
          jobId: normalizedOptions.jobId,
          skillBundleId: normalizedOptions.skillBundleId,
          modelPolicyId: normalizedOptions.modelPolicyId,
          phase,
          providerKey: provider.id,
          providerKind: provider.providerKind,
          providerName: provider.config.display_name || provider.name,
          model: provider.config.model,
          degraded: provider.providerKind === 'builtin',
          fallbackRank,
          requestId: normalizedOptions.requestId,
          metadata,
        }, startedAt),
        provider: provider.id,
        degraded: provider.providerKind === 'builtin',
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`${provider.id}: ${message}`)
      await recordModelInvocation({
        orgId: normalizedOptions.orgId,
        contractId: normalizedOptions.contractId,
        reviewId: normalizedOptions.reviewId,
        jobId: normalizedOptions.jobId,
        skillBundleId: normalizedOptions.skillBundleId,
        modelPolicyId: normalizedOptions.modelPolicyId,
        phase,
        providerKey: provider.id,
        providerKind: provider.providerKind,
        providerName: provider.config.display_name || provider.name,
        model: provider.config.model,
        status: 'failed',
        degraded: provider.providerKind === 'builtin',
        fallbackRank,
        error: message,
        requestId: normalizedOptions.requestId,
        metadata,
      })
      if (provider.providerKind === 'openai_compatible') {
        markProviderUnhealthy(provider.id)
      }
    }
  }

  const encoder = new TextEncoder()
  const fallbackStream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(JSON.stringify({
        risks: [{
          level: 'yellow',
          title: 'AI 服务暂时不可用',
          description: '所有 AI 提供方均不可用，建议人工审核',
          suggestion: '请法务同事人工审核此合同',
          source_quote: null,
          rule_code: null,
        }],
        summary: 'AI 审核服务暂时不可用，已切换至人工审核建议模式',
        _meta: { degraded: true, errors },
      })))
      controller.close()
    },
  })

  await recordModelInvocation({
    orgId: normalizedOptions.orgId,
    contractId: normalizedOptions.contractId,
    reviewId: normalizedOptions.reviewId,
    jobId: normalizedOptions.jobId,
    skillBundleId: normalizedOptions.skillBundleId,
    modelPolicyId: normalizedOptions.modelPolicyId,
    phase,
    providerKey: 'manual-fallback',
    providerKind: 'manual',
    providerName: '人工审核建议',
    model: 'manual-fallback',
    status: 'failed',
    degraded: true,
    fallbackRank: providers.length,
    error: errors.join(' | ') || 'no_provider_available',
    requestId: normalizedOptions.requestId,
    metadata: {
      consumer_tool: inferTool(normalizedOptions),
      required_capability: inferCapability(inferTool(normalizedOptions), normalizedOptions),
      attempted_provider_count: providers.length,
      policy_key: selection.policy?.key || null,
      application_key: selection.application?.key || null,
      routing_mode: selection.bundle.hasStructuredConfigs ? 'structured_policy' : 'legacy_provider_inference',
      mode: 'stream',
      ...reviewExecutionMetadata(normalizedOptions),
    },
  })

  return {
    stream: fallbackStream,
    provider: 'manual-fallback',
    degraded: true,
  }
}

export async function reviewWithFailoverSync(
  contractText: string,
  options?: string | ReviewOptions,
  maxRetries: number = 3
): Promise<SyncReviewResult> {
  const normalizedOptions = normalizeOptions(options)
  if (normalizedOptions.outputContract === 'facts_v1') {
    throw new Error('facts_v1_requires_extractReviewFactsWithFailoverSync')
  }
  const phase = normalizedOptions.phase || 'semantic_review'
  const selection = await loadRuntimeProviderSelection(
    normalizedOptions.orgId,
    contractText,
    normalizedOptions
  )
  const providers = selection.providers
  let lastError: string | undefined = selection.bundle.hasStructuredConfigs && !selection.policy
    ? `no_matching_tool_policy:${inferTool(normalizedOptions)}:${inferCapability(inferTool(normalizedOptions), normalizedOptions)}`
    : undefined
  let finalUsage: TokenUsage | undefined
  const attemptedProviders = new Set<string>()

  for (const [fallbackRank, provider] of providers.entries()) {
    const degraded = provider.providerKind === 'builtin'
    const tool = inferTool(normalizedOptions)
    const capability = inferCapability(tool, normalizedOptions)
    const pageCount = estimatePageCount(contractText)
    const metadata = {
      config_id: provider.config.config_id,
      routing: provider.config.routing,
      preferred_provider: normalizedOptions.preferredProvider || null,
      consumer_tool: tool,
      required_capability: capability,
      estimated_page_count: pageCount,
      configured_fallback_chain: provider.config.fallback_chain || [],
      policy_key: selection.policy?.key || null,
      policy_config_id: selection.policy?.config_id || null,
      policy_strategy: selection.policy?.strategy || null,
      application_key: selection.application?.key || null,
      application_config_id: selection.application?.config_id || null,
      routing_mode: selection.bundle.hasStructuredConfigs ? 'structured_policy' : 'legacy_provider_inference',
      ...reviewExecutionMetadata(normalizedOptions),
    }

    if (!(await isProviderHealthy(provider))) {
      attemptedProviders.add(provider.id)
      await recordModelInvocation({
        orgId: normalizedOptions.orgId,
        contractId: normalizedOptions.contractId,
        reviewId: normalizedOptions.reviewId,
        jobId: normalizedOptions.jobId,
        skillBundleId: normalizedOptions.skillBundleId,
        modelPolicyId: normalizedOptions.modelPolicyId,
        phase,
        providerKey: provider.id,
        providerKind: provider.providerKind,
        providerName: provider.config.display_name || provider.name,
        model: provider.config.model,
        status: 'skipped',
        degraded,
        fallbackRank,
        latencyMs: 0,
        error: 'provider_unhealthy',
        requestId: normalizedOptions.requestId,
        metadata,
      })
      continue
    }

    const configuredRetries = provider.policy?.retry_count ?? maxRetries
    for (let attempt = 0; attempt <= configuredRetries; attempt += 1) {
      attemptedProviders.add(provider.id)
      const abortController = new AbortController()
      let callResult: ProviderCallResult | undefined

      try {
        callResult = await withTimeout(
          callProviderSync(provider, contractText, normalizedOptions.orgId, attempt, abortController.signal, normalizedOptions),
          provider.timeout,
          abortController
        )

        if (callResult.finishReason === 'length') {
          throw new Error(MODEL_OUTPUT_TRUNCATED)
        }

        const validation = validateAIOutput(callResult.text)
        finalUsage = callResult.usage

        await recordModelInvocation({
          orgId: normalizedOptions.orgId,
          contractId: normalizedOptions.contractId,
          reviewId: normalizedOptions.reviewId,
          jobId: normalizedOptions.jobId,
          skillBundleId: normalizedOptions.skillBundleId,
          modelPolicyId: normalizedOptions.modelPolicyId,
          phase,
          providerKey: provider.id,
          providerKind: provider.providerKind,
          providerName: provider.config.display_name || provider.name,
          model: provider.config.model,
          status: validation.valid ? 'succeeded' : 'failed',
          degraded,
          fallbackRank,
          usage: callResult.usage,
          latencyMs: callResult.latencyMs,
          error: validation.valid ? undefined : validation.error,
          requestId: callResult.requestId || normalizedOptions.requestId,
          metadata: {
            ...metadata,
            attempt,
            validation_valid: validation.valid,
          },
        })

        if (validation.valid && validation.data) {
          return {
            risks: validation.data.risks,
            summary: validation.data.summary,
            provider: provider.id,
            degraded,
            usage: callResult.usage,
          }
        }

        lastError = validation.error
        if (provider.providerKind === 'builtin') {
          break
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        lastError = message
        await recordModelInvocation({
          orgId: normalizedOptions.orgId,
          contractId: normalizedOptions.contractId,
          reviewId: normalizedOptions.reviewId,
          jobId: normalizedOptions.jobId,
          skillBundleId: normalizedOptions.skillBundleId,
          modelPolicyId: normalizedOptions.modelPolicyId,
          phase,
          providerKey: provider.id,
          providerKind: provider.providerKind,
          providerName: provider.config.display_name || provider.name,
          model: provider.config.model,
          status: 'failed',
          degraded,
          fallbackRank,
          usage: callResult?.usage,
          latencyMs: callResult?.latencyMs,
          error: message,
          requestId: callResult?.requestId || normalizedOptions.requestId,
          metadata: {
            ...metadata,
            attempt,
            finish_reason: callResult?.finishReason || null,
          },
        })

        const outputWasTruncated = message === MODEL_OUTPUT_TRUNCATED
        if (provider.providerKind === 'openai_compatible' && !outputWasTruncated) {
          markProviderUnhealthy(provider.id)
        }
        if (outputWasTruncated) break
      }
    }
  }

  await recordModelInvocation({
    orgId: normalizedOptions.orgId,
    contractId: normalizedOptions.contractId,
    reviewId: normalizedOptions.reviewId,
    jobId: normalizedOptions.jobId,
    skillBundleId: normalizedOptions.skillBundleId,
    modelPolicyId: normalizedOptions.modelPolicyId,
    phase,
    providerKey: 'manual-fallback',
    providerKind: 'manual',
    providerName: '人工审核建议',
    model: 'manual-fallback',
    status: 'failed',
    degraded: true,
    fallbackRank: providers.length,
    usage: finalUsage,
    error: lastError || 'no_provider_available',
    requestId: normalizedOptions.requestId,
    metadata: {
      attempted_provider_count: attemptedProviders.size,
      preferred_provider: normalizedOptions.preferredProvider || null,
      consumer_tool: inferTool(normalizedOptions),
      required_capability: inferCapability(inferTool(normalizedOptions), normalizedOptions),
      policy_key: selection.policy?.key || null,
      application_key: selection.application?.key || null,
      routing_mode: selection.bundle.hasStructuredConfigs ? 'structured_policy' : 'legacy_provider_inference',
      ...reviewExecutionMetadata(normalizedOptions),
    },
  })

  return {
    risks: [{
      level: 'yellow',
      title: 'AI 输出格式异常',
      description: lastError || 'AI 输出无法解析',
      suggestion: '建议人工复核此合同',
      source_quote: null,
      rule_code: null,
    }],
    summary: `AI 审核输出格式异常，已降级到人工审核建议（已尝试 ${attemptedProviders.size} 个 provider）`,
    provider: 'manual-fallback',
    degraded: true,
  }
}

/**
 * Candidate-only extraction path. It never calls the legacy rule-engine
 * fallback and never accepts a model-produced severity. A successful result
 * is returned only after the exact completed invocation row (including token
 * usage) has been persisted, so later adjudication traces can bind to it.
 */
export async function extractReviewFactsWithFailoverSync(
  contractText: string,
  options: FactsOnlyReviewOptions,
  maxRetries: number = 1,
): Promise<SyncFactExtractionResult> {
  if (!options.deterministicRules.length) {
    throw new Error('facts_only_rule_catalog_empty')
  }
  if (typeof options.persistSuccessfulExtraction !== 'function') {
    throw new Error('facts_only_atomic_checkpoint_writer_required')
  }
  if (typeof options.prepareSuccessfulExtraction !== 'function') {
    throw new Error('facts_only_source_validation_hook_required')
  }
  for (const [field, value] of Object.entries({
    orgId: options.orgId,
    contractId: options.contractId,
    reviewId: options.reviewId,
    jobId: options.jobId,
    skillBundleId: options.skillBundleId,
    modelPolicyId: options.modelPolicyId,
  })) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`facts_only_${field}_required`)
    }
  }
  if (
    !Number.isInteger(options.chunk.index)
    || !Number.isInteger(options.chunk.total)
    || options.chunk.index < 1
    || options.chunk.total < options.chunk.index
    || !Number.isInteger(options.chunk.start)
    || !Number.isInteger(options.chunk.end)
    || options.chunk.start < 0
    || options.chunk.end - options.chunk.start !== contractText.length
    || !/^[0-9a-f]{64}$/i.test(options.chunk.hash)
    || createHash('sha256').update(contractText).digest('hex') !== options.chunk.hash.toLowerCase()
  ) {
    throw new Error('facts_only_chunk_provenance_invalid')
  }
  const normalizedOptions: ReviewOptions = {
    ...options,
    outputContract: 'facts_v1',
  }
  // Build both prompt and strict schema before selecting or calling a provider.
  // Invalid candidate assets therefore fail without spending tokens.
  buildFactsOnlyExtractionInstruction(options.deterministicRules)
  buildFactsOnlyExtractionJsonSchema(options.deterministicRules)

  const phase = normalizedOptions.phase || 'fact_extraction'
  const selection = await loadRuntimeProviderSelection(
    normalizedOptions.orgId,
    contractText,
    normalizedOptions,
  )
  const providers = selection.providers.filter((provider) => provider.providerKind === 'openai_compatible')
  const errors: string[] = []
  if (providers.length === 0) {
    throw new Error('facts_only_no_model_provider')
  }

  for (const [fallbackRank, provider] of providers.entries()) {
    const tool = inferTool(normalizedOptions)
    const capability = inferCapability(tool, normalizedOptions)
    const metadata = {
      config_id: provider.config.config_id,
      routing: provider.config.routing,
      preferred_provider: normalizedOptions.preferredProvider || null,
      consumer_tool: tool,
      required_capability: capability,
      estimated_page_count: estimatePageCount(contractText),
      configured_fallback_chain: provider.config.fallback_chain || [],
      policy_key: selection.policy?.key || null,
      policy_config_id: selection.policy?.config_id || null,
      policy_strategy: selection.policy?.strategy || null,
      application_key: selection.application?.key || null,
      application_config_id: selection.application?.config_id || null,
      routing_mode: selection.bundle.hasStructuredConfigs ? 'structured_policy' : 'legacy_provider_inference',
      ...reviewExecutionMetadata(normalizedOptions),
    }

    if (!(await isProviderHealthy(provider))) {
      await recordModelInvocation({
        orgId: normalizedOptions.orgId,
        contractId: normalizedOptions.contractId,
        reviewId: normalizedOptions.reviewId,
        jobId: normalizedOptions.jobId,
        skillBundleId: normalizedOptions.skillBundleId,
        modelPolicyId: normalizedOptions.modelPolicyId,
        phase,
        providerKey: provider.id,
        providerKind: provider.providerKind,
        providerName: provider.config.display_name || provider.name,
        model: provider.config.model,
        status: 'skipped',
        degraded: false,
        fallbackRank,
        latencyMs: 0,
        error: 'provider_unhealthy',
        requestId: normalizedOptions.requestId,
        metadata,
      })
      errors.push(`${provider.id}: provider_unhealthy`)
      continue
    }

    // One original attempt plus one repair is the hard ceiling for this path.
    const configuredRetries = Math.min(1, Math.max(0, provider.policy?.retry_count ?? maxRetries))
    for (let attempt = 0; attempt <= configuredRetries; attempt += 1) {
      const abortController = new AbortController()
      let callResult: ProviderCallResult | undefined
      try {
        callResult = await withTimeout(
          callProviderSync(
            provider,
            contractText,
            normalizedOptions.orgId,
            attempt,
            abortController.signal,
            normalizedOptions,
          ),
          provider.timeout,
          abortController,
        )
        if (callResult.finishReason === 'length') throw new Error(MODEL_OUTPUT_TRUNCATED)
        const providerExtraction = parseFactsOnlyExtraction(callResult.text, options.deterministicRules)
        const trustedContextNormalizations = getFactsOnlyExtractionTrustedContextNormalizations(
          providerExtraction,
        )
        const modelFactNormalizations = getFactsOnlyExtractionModelFactNormalizations(
          providerExtraction,
        )
        const extraction = await options.prepareSuccessfulExtraction(providerExtraction)
        const coverageNormalizations = getFactsOnlyExtractionCoverageNormalizations(extraction)
        const sourceAnchorNormalizations = getFactsOnlyExtractionSourceAnchorNormalizations(extraction)
        // The staging RPC consumes one strict JSON object, not provider
        // presentation bytes. Canonicalize the already validated extraction so
        // exact code fences and conservative coverage downgrades cannot drift
        // between the TypeScript validator and the SQL evidence contract.
        const stagedOutput = serializeFactsOnlyExtractionForStage(extraction, options.deterministicRules)
        const providerRawOutputSha256 = createHash('sha256').update(callResult.text).digest('hex')
        const stagedOutputSha256 = createHash('sha256').update(stagedOutput).digest('hex')
        const usage = callResult.usage
        if (!usage || !(Number(usage.totalTokens) > 0)) {
          throw new Error('facts_only_token_evidence_missing')
        }

        const requestMetadata = {
          ...metadata,
          attempt,
          validation_valid: true,
        }
        const responseMetadata = {
          output_contract: 'facts_v1',
          raw_output_sha256: stagedOutputSha256,
          provider_raw_output_sha256: providerRawOutputSha256,
          staged_output_sha256: stagedOutputSha256,
          output_canonicalized: true,
          facts_candidate_count: extraction.candidates.length,
          coverage_normalization_count: coverageNormalizations.length,
          coverage_normalizations: coverageNormalizations,
          trusted_context_normalization_count: trustedContextNormalizations.length,
          trusted_context_normalizations: trustedContextNormalizations,
          model_fact_normalization_count: modelFactNormalizations.length,
          model_fact_normalizations: modelFactNormalizations,
          source_anchor_normalization_count: sourceAnchorNormalizations.length,
          source_anchor_normalizations: sourceAnchorNormalizations,
          chunk_hash: normalizedOptions.chunk?.hash || null,
        }
        let invocationId: string
        try {
          const persisted = await options.persistSuccessfulExtraction({
            provider: provider.id,
            providerKind: 'openai_compatible',
            providerName: provider.config.display_name || provider.name,
            model: provider.config.model,
            fallbackRank,
            attempt,
            usage,
            latencyMs: callResult.latencyMs,
            requestId: callResult.requestId || normalizedOptions.requestId,
            requestMetadata,
            responseMetadata,
            rawOutput: stagedOutput,
          })
          if (!persisted.invocationId) throw new Error('missing invocation id')
          invocationId = persisted.invocationId
        } catch (error) {
          throw new Error(
            `facts_only_invocation_checkpoint_write_failed:${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
          )
        }
        return {
          extraction,
          rawOutput: stagedOutput,
          provider: provider.id,
          degraded: false,
          usage,
          invocationId,
        }
      } catch (error) {
        const message = error instanceof FactsOnlyRuntimeError
          ? `deterministic_validation:${error.code}:${error.message}`
          : error instanceof Error ? error.message : String(error)
        errors.push(`${provider.id}[${attempt}]: ${message}`)
        if (
          message.startsWith('facts_only_invocation_evidence_write_failed:')
          || message.startsWith('facts_only_invocation_checkpoint_write_failed:')
        ) {
          // Provider retries cannot repair a missing audit write.
          throw new Error(message)
        }
        await recordModelInvocation({
          orgId: normalizedOptions.orgId,
          contractId: normalizedOptions.contractId,
          reviewId: normalizedOptions.reviewId,
          jobId: normalizedOptions.jobId,
          skillBundleId: normalizedOptions.skillBundleId,
          modelPolicyId: normalizedOptions.modelPolicyId,
          phase,
          providerKey: provider.id,
          providerKind: provider.providerKind,
          providerName: provider.config.display_name || provider.name,
          model: provider.config.model,
          status: 'failed',
          degraded: false,
          fallbackRank,
          usage: callResult?.usage,
          latencyMs: callResult?.latencyMs,
          error: message,
          requestId: callResult?.requestId || normalizedOptions.requestId,
          metadata: {
            ...metadata,
            attempt,
            validation_valid: false,
            finish_reason: callResult?.finishReason || null,
          },
        })
        if (!callResult && message !== MODEL_OUTPUT_TRUNCATED) {
          markProviderUnhealthy(provider.id)
        }
        if (message === MODEL_OUTPUT_TRUNCATED) break
      }
    }
  }

  throw new Error(`facts_only_extraction_failed:${errors.join(' | ') || 'no_provider_available'}`)
}
