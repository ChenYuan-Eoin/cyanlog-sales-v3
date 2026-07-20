import { supabaseAdmin } from '@/lib/supabase'
import type { AIConfigValue, AIModelStage, AIProviderKind, ConfigType, TaxRuleValue } from '@/lib/configs/types'
import { normalizeOpenAICompatibleBaseUrl } from '@/lib/ai/openai-compatible'
import { getAIConfigKind } from '@/lib/configs/ai-config-kind'
import { redactSecretsDeep } from '@/lib/configs/secret-redaction'
import { canonicalizeProviderBaseUrl } from '@/lib/configs/provider-endpoint'

type JsonRecord = Record<string, unknown>

interface ConfigRow {
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
  display_name: string
}

export function maskApiKey(apiKey: string): string {
  void apiKey
  // A constant mask reveals neither length nor prefix/suffix. Server
  // persistence and publish gates still reject this presentation sentinel.
  return '****'
}

export function isMaskedApiKey(value: string | undefined): boolean {
  if (typeof value !== 'string') return false
  // Accept the current sentinel and the two exact shapes emitted by older
  // clients. Do not classify an arbitrary real token containing stars as a
  // mask merely because it includes "***".
  return value === '****'
    || value === '***'
    || /^[^*]{4}\*{3}[^*]{4}$/.test(value)
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

export function withoutStoredApiKey(value: JsonRecord): JsonRecord {
  const { api_key: _discardedApiKey, ...rest } = value
  return rest
}

export function providerCredentialBindingMatches(
  currentValue: JsonRecord | null | undefined,
  targetValue: JsonRecord
): boolean {
  if (!currentValue) return false

  const platformProvider = currentValue.kind === 'provider_connection' || targetValue.kind === 'provider_connection'
  const fields = platformProvider
    ? ['kind', 'provider_type', 'base_url', 'runtime_location', 'auth_mode']
    : ['provider_kind', 'base_url', 'profile']

  return fields.every((field) => (
    providerIdentityField(currentValue, field, platformProvider)
    === providerIdentityField(targetValue, field, platformProvider)
  ))
}

function providerIdentityField(value: JsonRecord, field: string, platformProvider: boolean): string {
  if (field === 'base_url') {
    try {
      return canonicalizeProviderBaseUrl(typeof value.base_url === 'string' ? value.base_url : '')
    } catch {
      return typeof value.base_url === 'string' ? value.base_url.trim() : ''
    }
  }
  if (field === 'auth_mode' && platformProvider) {
    if (value.auth_mode === 'none' || value.auth_mode === 'bearer') return value.auth_mode
    return typeof value.api_key === 'string' && value.api_key.length > 0 ? 'bearer' : 'none'
  }
  return typeof value[field] === 'string' ? String(value[field]).trim() : ''
}

export type ProviderCredentialAction = 'reuse' | 'replace' | 'clear'

export function applyProviderRevisionCredential(
  sourceValue: JsonRecord,
  targetValue: JsonRecord,
  action: ProviderCredentialAction,
): { ok: true; value: JsonRecord } | { ok: false; error: string } {
  if (sourceValue.kind !== 'provider_connection' || targetValue.kind !== 'provider_connection') {
    return { ok: false, error: '凭据动作只适用于 ProviderConnection 修订' }
  }

  const sourceKey = typeof sourceValue.api_key === 'string' ? sourceValue.api_key : undefined
  const targetKey = typeof targetValue.api_key === 'string' ? targetValue.api_key : undefined
  const targetAuthMode = providerIdentityField(targetValue, 'auth_mode', true)

  if (action === 'clear') {
    return { ok: true, value: withoutStoredApiKey(targetValue) }
  }
  if (targetAuthMode !== 'bearer') {
    return { ok: false, error: '只有 Bearer 认证连接可以保存或复用凭据' }
  }
  if (action === 'replace') {
    if (!targetKey || isMaskedApiKey(targetKey)) {
      return { ok: false, error: '替换凭据必须提交新的真实 Token' }
    }
    return { ok: true, value: { ...targetValue, api_key: targetKey } }
  }
  if (!providerCredentialBindingMatches(sourceValue, targetValue)) {
    return { ok: false, error: '连接端点、位置、认证方式发生变化，不能复用旧凭据' }
  }
  if (!sourceKey || isMaskedApiKey(sourceKey)) {
    return { ok: false, error: '来源 Provider 没有可复用的真实凭据' }
  }
  return { ok: true, value: { ...targetValue, api_key: sourceKey } }
}

export function mergeStoredAIProviderValue(
  existingValue: JsonRecord | null | undefined,
  nextValue: JsonRecord
): JsonRecord {
  const existingApiKey = typeof existingValue?.api_key === 'string' ? existingValue.api_key : undefined
  const suppliedApiKey = typeof nextValue.api_key === 'string' ? nextValue.api_key : undefined
  const merged = { ...existingValue, ...nextValue }
  if (
    merged.kind === 'provider_connection'
    && merged.auth_mode !== 'none'
    && merged.auth_mode !== 'bearer'
  ) {
    merged.auth_mode = existingApiKey ? 'bearer' : 'none'
  }
  const targetAuthMode = providerIdentityField(merged, 'auth_mode', merged.kind === 'provider_connection')

  if (targetAuthMode === 'none') {
    return withoutStoredApiKey(merged)
  }
  if (suppliedApiKey && !isMaskedApiKey(suppliedApiKey)) {
    return { ...merged, api_key: suppliedApiKey }
  }
  if (providerCredentialBindingMatches(existingValue, merged) && existingApiKey) {
    return { ...merged, api_key: existingApiKey }
  }

  return withoutStoredApiKey(merged)
}

export function sanitizeConfigRow<T extends { type: string; value?: JsonRecord | null }>(row: T): T {
  const value = sanitizeConfigValue(row.type, row.value)
  if (value === row.value) {
    return row
  }

  return {
    ...row,
    value,
  }
}

export function sanitizeConfigValue<T extends JsonRecord | null | undefined>(
  type: string,
  value: T
): T {
  if (type !== 'AI_CONFIG' || !value) {
    return value
  }

  const apiKey = typeof value.api_key === 'string' ? value.api_key : undefined
  const redacted = redactSecretsDeep(value, [apiKey])
  return (apiKey
    ? { ...redacted, api_key: maskApiKey(apiKey) }
    : redacted) as T
}

export function sanitizeConfigVersionRow<
  T extends { value?: JsonRecord | null },
>(type: string, row: T): T {
  const value = sanitizeConfigValue(type, row.value)
  if (value === row.value) {
    return row
  }

  return {
    ...row,
    value,
  }
}

export async function getUserIdForToken(token: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('auth_tokens')
    .select('user_id, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (error || !data?.user_id) {
    return null
  }

  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return null
  }

  return data.user_id
}

export async function getOrgIdForUser(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('user_organizations')
    .select('org_id')
    .eq('user_id', userId)
    .eq('is_default', true)
    .maybeSingle()

  if (data?.org_id) {
    return data.org_id
  }

  const { data: userRow } = await supabaseAdmin
    .from('users')
    .select('org_id')
    .eq('id', userId)
    .maybeSingle()

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

function normalizeProviderKind(value: JsonRecord): AIProviderKind {
  if (value.provider_kind === 'builtin') {
    return 'builtin'
  }
  if (value.model === 'rule-engine') {
    return 'builtin'
  }
  return 'openai_compatible'
}

function isLocalEndpoint(baseUrl: string): boolean {
  if (!baseUrl) return false
  try {
    const url = new URL(baseUrl)
    return ['localhost', '127.0.0.1', '0.0.0.0'].includes(url.hostname)
  } catch {
    return false
  }
}

function providerTier(config: PublishedAIProviderConfig): number {
  if (config.provider_kind === 'builtin' || config.model === 'rule-engine') return 3
  if (isLocalEndpoint(config.base_url) || config.profile?.toLowerCase().includes('local')) return 1
  return 2
}

function normalizeAIConfig(row: ConfigRow): PublishedAIProviderConfig {
  const value = row.value || {}
  const providerKind = normalizeProviderKind(value)
  return {
    config_id: row.id,
    key: row.key,
    display_name: row.name,
    level: Number(value.level ?? 1),
    name: String(value.name ?? row.name),
    profile: typeof value.profile === 'string' ? value.profile : undefined,
    provider_kind: providerKind,
    base_url: providerKind === 'openai_compatible'
      ? normalizeOpenAICompatibleBaseUrl(String(value.base_url ?? ''))
      : String(value.base_url ?? ''),
    api_key: typeof value.api_key === 'string' ? value.api_key : undefined,
    model: String(value.model ?? ''),
    timeout_ms: Number(value.timeout_ms ?? 45000),
    enabled: Boolean(value.enabled ?? true),
    routing: value.routing && typeof value.routing === 'object'
      ? {
          max_pages: Number((value.routing as JsonRecord).max_pages ?? 15),
          strategy: ((value.routing as JsonRecord).strategy as 'full' | 'chunked' | 'rule' | undefined) ?? 'full',
        }
      : undefined,
    stages: Array.isArray(value.stages)
      ? value.stages.filter((stage): stage is AIModelStage => typeof stage === 'string')
      : undefined,
  }
}

/** Only provider records may enter the runtime provider chain. */
export function isPublishedAIProviderValue(value: JsonRecord): boolean {
  if (getAIConfigKind(value) !== 'provider') return false
  const hasProviderShape = typeof value.model === 'string'
    && value.model.trim().length > 0
    && (typeof value.base_url === 'string'
      || typeof value.provider_kind === 'string'
      || typeof value.profile === 'string')
  return hasProviderShape
}

export async function listPublishedAIProviders(orgId: string): Promise<PublishedAIProviderConfig[]> {
  const configs = await listPublishedConfigsByType('AI_CONFIG', orgId)
  return configs
    .filter((row) => isPublishedAIProviderValue(row.value || {}))
    .map(normalizeAIConfig)
    .filter((config) => config.enabled)
    .sort((left, right) => (
      providerTier(left) - providerTier(right)
      || left.level - right.level
    ))
}

export async function getPublishedTaxRate(orgId: string): Promise<number> {
  const configs = await listPublishedConfigsByType('TAX_RULE', orgId)
  const enabled = configs
    .map((config) => config.value as TaxRuleValue | null)
    .find((value) => Boolean(value?.enabled))

  return typeof enabled?.rate === 'number' ? enabled.rate : 0
}
