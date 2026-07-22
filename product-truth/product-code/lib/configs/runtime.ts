import { supabaseAdmin } from '@/lib/supabase'
import {
  getAIProviderInstanceId,
  getAIConfigKind,
  type AIApplicationConfigValue,
  type AIConfigValue,
  type AIProviderKind,
  type AIToolPolicyConfigValue,
  type ConfigType,
  type TaxRuleValue,
} from '@/lib/configs/types'

type JsonRecord = Record<string, unknown>

export interface ConfigRow {
  id: string
  key: string
  name: string
  value: JsonRecord | null
  type: ConfigType
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'
  org_id: string | null
  updated_at: string
}

export interface PublishedAIProviderConfig extends AIConfigValue {
  config_id: string
  key: string
  instance_id: string
  display_name: string
}

export interface PublishedAIApplicationConfig extends AIApplicationConfigValue {
  config_id: string
  key: string
  display_name: string
}

export interface PublishedAIToolPolicyConfig extends AIToolPolicyConfigValue {
  config_id: string
  key: string
  display_name: string
}

export interface PublishedAIConfigBundle {
  providers: PublishedAIProviderConfig[]
  applications: PublishedAIApplicationConfig[]
  toolPolicies: PublishedAIToolPolicyConfig[]
  hasPublishedConfigs: boolean
  hasStructuredConfigs: boolean
}

export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 12) {
    return '***'
  }
  return `${apiKey.slice(0, 4)}***${apiKey.slice(-4)}`
}

export function isMaskedApiKey(value: string | undefined): boolean {
  return typeof value === 'string' && value.includes('***')
}

export function mergeStoredAIConfigValue(
  existingValue: JsonRecord | null | undefined,
  nextValue: JsonRecord
): JsonRecord {
  const existingApiKey = typeof existingValue?.api_key === 'string' ? existingValue.api_key : undefined
  const nextApiKey = typeof nextValue.api_key === 'string' ? nextValue.api_key : undefined

  return {
    ...existingValue,
    ...nextValue,
    api_key: nextApiKey && !isMaskedApiKey(nextApiKey)
      ? nextApiKey
      : existingApiKey,
  }
}

export function sanitizeConfigRow<T extends { type: string; value?: JsonRecord | null }>(row: T): T {
  if (row.type !== 'AI_CONFIG' || typeof row.value?.api_key !== 'string' || row.value.api_key.length === 0) {
    return row
  }

  return {
    ...row,
    value: {
      ...row.value,
      api_key: maskApiKey(row.value.api_key),
    },
  }
}

export async function getUserIdForToken(token: string): Promise<string | null> {
  const t = Date.now()
  const { data, error } = await supabaseAdmin
    .from('auth_tokens')
    .select('user_id, expires_at')
    .eq('token', token)
    .maybeSingle()
  console.log(`[PERF] getUserIdForToken=${Date.now() - t}ms found=${!!data?.user_id}`)

  if (error || !data?.user_id) {
    return null
  }

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return null
  }

  return data.user_id
}

export async function getOrgIdForUser(userId: string): Promise<string | null> {
  const t = Date.now()
  const { data } = await supabaseAdmin
    .from('user_organizations')
    .select('org_id')
    .eq('user_id', userId)
    .eq('is_default', true)
    .maybeSingle()

  if (data?.org_id) {
    console.log(`[PERF] getOrgIdForUser (user_orgs)=${Date.now() - t}ms orgId=${data.org_id}`)
    return data.org_id
  }

  const t2 = Date.now()
  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('org_id')
    .eq('id', userId)
    .maybeSingle()
  console.log(`[PERF] getOrgIdForUser (users fallback)=${Date.now() - t2}ms orgId=${userRow?.org_id}`)

  return userRow?.org_id ?? null
}

export async function getOrgIdForToken(token: string | undefined): Promise<string | null> {
  if (!token) {
    return null
  }

  const userId = await getUserIdForToken(token)
  if (!userId) {
    return null
  }

  return getOrgIdForUser(userId)
}

export async function listPublishedConfigsByType(type: ConfigType, orgId: string): Promise<ConfigRow[]> {
  const { data, error } = await supabaseAdmin
    .from('configs')
    .select('id, key, name, value, type, status, org_id, updated_at')
    .eq('org_id', orgId)
    .eq('type', type)
    .eq('status', 'PUBLISHED')
    .order('updated_at', { ascending: false })

  if (error) {
    throw error
  }

  return ((data || []) as ConfigRow[])
}

const AI_PROVIDER_KINDS: AIProviderKind[] = [
  'openai_compatible',
  'lm_studio',
  'openai',
  'anthropic',
  'builtin',
  'rule_engine',
  'custom',
]
const AI_ROUTING_STRATEGIES = ['full', 'chunked', 'rule', 'local_first', 'quality_first', 'cost_first', 'compliance_first'] as const

function normalizeProviderKind(value: JsonRecord): AIProviderKind {
  if (typeof value.provider_kind === 'string' && AI_PROVIDER_KINDS.includes(value.provider_kind as AIProviderKind)) {
    return value.provider_kind as AIProviderKind
  }
  if (value.model === 'rule-engine') {
    return 'rule_engine'
  }
  return 'openai_compatible'
}

function getStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function getModelMappings(value: unknown): AIConfigValue['model_mappings'] {
  if (!Array.isArray(value)) {
    return undefined
  }
  return value
    .filter((entry): entry is JsonRecord => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    .map((entry) => ({
      role: String(entry.role ?? 'default'),
      display_name: typeof entry.display_name === 'string' ? entry.display_name : undefined,
      request_model: String(entry.request_model ?? '').trim(),
      context_window: typeof entry.context_window === 'number' ? entry.context_window : undefined,
      enabled: typeof entry.enabled === 'boolean' ? entry.enabled : undefined,
    }))
}

export function resolveRuntimeModel(value: {
  model?: string
  model_mappings?: AIConfigValue['model_mappings']
}): string {
  const directModel = typeof value.model === 'string' ? value.model.trim() : ''
  if (directModel) {
    return directModel
  }

  const enabledMappings = (value.model_mappings || []).filter((mapping) => (
    mapping.enabled !== false && typeof mapping.request_model === 'string' && mapping.request_model.trim()
  ))
  const defaultMapping = enabledMappings.find((mapping) => mapping.role === 'default')
  return (defaultMapping || enabledMappings[0])?.request_model.trim() || ''
}

function normalizeRoutingStrategy(value: unknown): NonNullable<AIConfigValue['routing']>['strategy'] {
  return typeof value === 'string' && AI_ROUTING_STRATEGIES.includes(value as NonNullable<AIConfigValue['routing']>['strategy'])
    ? value as NonNullable<AIConfigValue['routing']>['strategy']
    : 'full'
}

function normalizeAIProvider(row: ConfigRow): PublishedAIProviderConfig {
  const value = row.value || {}
  const modelMappings = getModelMappings(value.model_mappings)
  return {
    kind: 'provider',
    config_id: row.id,
    key: row.key,
    instance_id: getAIProviderInstanceId(value, row.key),
    display_name: row.name,
    level: Number(value.level ?? 1),
    name: String(value.name ?? row.name),
    profile: typeof value.profile === 'string' ? value.profile : undefined,
    provider_name: typeof value.provider_name === 'string' ? value.provider_name : undefined,
    provider_url: typeof value.provider_url === 'string' ? value.provider_url : undefined,
    provider_kind: normalizeProviderKind(value),
    api_format: typeof value.api_format === 'string' ? value.api_format : undefined,
    base_url: String(value.base_url ?? ''),
    api_key: typeof value.api_key === 'string' ? value.api_key : undefined,
    model: resolveRuntimeModel({
      model: typeof value.model === 'string' ? value.model : undefined,
      model_mappings: modelMappings,
    }),
    model_mappings: modelMappings,
    capabilities: getStringArray(value.capabilities),
    bound_apps: getStringArray(value.bound_apps),
    system_prompt: typeof value.system_prompt === 'string' ? value.system_prompt : undefined,
    fallback_chain: getStringArray(value.fallback_chain),
    retry_count: typeof value.retry_count === 'number' ? value.retry_count : undefined,
    cost_tracking: typeof value.cost_tracking === 'boolean' ? value.cost_tracking : undefined,
    json_config: value.json_config && typeof value.json_config === 'object' && !Array.isArray(value.json_config)
      ? value.json_config as Record<string, unknown>
      : undefined,
    json_config_text: typeof value.json_config_text === 'string' ? value.json_config_text : undefined,
    timeout_ms: Number(value.timeout_ms ?? 45000),
    enabled: Boolean(value.enabled ?? true),
    routing: value.routing && typeof value.routing === 'object'
      ? {
          max_pages: Number((value.routing as JsonRecord).max_pages ?? 15),
          strategy: normalizeRoutingStrategy((value.routing as JsonRecord).strategy),
        }
      : undefined,
  }
}

function normalizeAIApplication(row: ConfigRow): PublishedAIApplicationConfig {
  const value = row.value || {}
  return {
    kind: 'application',
    config_id: row.id,
    key: row.key,
    display_name: row.name,
    name: String(value.name ?? row.name),
    enabled: Boolean(value.enabled ?? true),
    application_id: typeof value.application_id === 'string' ? value.application_id : undefined,
    plan_mode: value.plan_mode === 'manual' || value.plan_mode === 'scheduled'
      ? value.plan_mode
      : 'always_on',
    capabilities: getStringArray(value.capabilities),
    bound_tools: getStringArray(value.bound_tools),
    system_prompt: typeof value.system_prompt === 'string' ? value.system_prompt : undefined,
    default_policy_key: typeof value.default_policy_key === 'string' ? value.default_policy_key : undefined,
    json_config: value.json_config && typeof value.json_config === 'object' && !Array.isArray(value.json_config)
      ? value.json_config as Record<string, unknown>
      : undefined,
    json_config_text: typeof value.json_config_text === 'string' ? value.json_config_text : undefined,
  }
}

function getPolicyConditions(value: unknown): AIToolPolicyConfigValue['conditions'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const conditions = value as JsonRecord
  return {
    min_chars: typeof conditions.min_chars === 'number' ? conditions.min_chars : undefined,
    max_chars: typeof conditions.max_chars === 'number' ? conditions.max_chars : undefined,
    min_pages: typeof conditions.min_pages === 'number' ? conditions.min_pages : undefined,
    max_pages: typeof conditions.max_pages === 'number' ? conditions.max_pages : undefined,
    document_formats: getStringArray(conditions.document_formats),
    sensitive_data: conditions.sensitive_data === 'local_only' || conditions.sensitive_data === 'allow_cloud'
      ? conditions.sensitive_data
      : 'any',
  }
}

function normalizeAIToolPolicy(row: ConfigRow): PublishedAIToolPolicyConfig {
  const value = row.value || {}
  return {
    kind: 'tool_policy',
    config_id: row.id,
    key: row.key,
    display_name: row.name,
    name: String(value.name ?? row.name),
    enabled: Boolean(value.enabled ?? true),
    tool: String(value.tool ?? ''),
    capability: String(value.capability ?? ''),
    application_key: typeof value.application_key === 'string' ? value.application_key : undefined,
    strategy: normalizeRoutingStrategy(value.strategy),
    priority: Number(value.priority ?? 100),
    provider_chain: getStringArray(value.provider_chain) || [],
    fallback_chain: getStringArray(value.fallback_chain),
    timeout_ms: Number(value.timeout_ms ?? 45_000),
    retry_count: typeof value.retry_count === 'number' ? value.retry_count : undefined,
    cost_tracking: typeof value.cost_tracking === 'boolean' ? value.cost_tracking : undefined,
    conditions: getPolicyConditions(value.conditions),
    json_config: value.json_config && typeof value.json_config === 'object' && !Array.isArray(value.json_config)
      ? value.json_config as Record<string, unknown>
      : undefined,
    json_config_text: typeof value.json_config_text === 'string' ? value.json_config_text : undefined,
  }
}

export function splitPublishedAIConfigs(configs: ConfigRow[]): PublishedAIConfigBundle {
  const providers: PublishedAIProviderConfig[] = []
  const applications: PublishedAIApplicationConfig[] = []
  const toolPolicies: PublishedAIToolPolicyConfig[] = []
  let hasStructuredConfigs = false

  for (const row of configs) {
    const kind = getAIConfigKind(row.value)
    if (kind === 'application') {
      hasStructuredConfigs = true
      const application = normalizeAIApplication(row)
      if (application.enabled) applications.push(application)
      continue
    }
    if (kind === 'tool_policy') {
      hasStructuredConfigs = true
      const policy = normalizeAIToolPolicy(row)
      if (policy.enabled) toolPolicies.push(policy)
      continue
    }

    const provider = normalizeAIProvider(row)
    if (provider.enabled) providers.push(provider)
  }

  return {
    providers: providers.sort((left, right) => left.level - right.level),
    applications: applications.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
    toolPolicies: toolPolicies.sort((left, right) => left.priority - right.priority),
    hasPublishedConfigs: configs.length > 0,
    hasStructuredConfigs,
  }
}

export async function listPublishedAIConfigBundle(orgId: string): Promise<PublishedAIConfigBundle> {
  const configs = await listPublishedConfigsByType('AI_CONFIG', orgId)
  return splitPublishedAIConfigs(configs)
}

export async function listPublishedAIProviders(orgId: string): Promise<PublishedAIProviderConfig[]> {
  return (await listPublishedAIConfigBundle(orgId)).providers
}

export async function listPublishedAIApplications(orgId: string): Promise<PublishedAIApplicationConfig[]> {
  return (await listPublishedAIConfigBundle(orgId)).applications
}

export async function listPublishedAIToolPolicies(orgId: string): Promise<PublishedAIToolPolicyConfig[]> {
  return (await listPublishedAIConfigBundle(orgId)).toolPolicies
}

export async function getPublishedTaxRate(orgId: string): Promise<number> {
  const configs = await listPublishedConfigsByType('TAX_RULE', orgId)
  const enabled = configs
    .map((config) => config.value as TaxRuleValue | null)
    .find((value) => Boolean(value?.enabled))

  return typeof enabled?.rate === 'number' ? enabled.rate : 0
}
