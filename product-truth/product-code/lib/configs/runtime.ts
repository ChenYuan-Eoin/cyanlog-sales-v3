import { supabaseAdmin } from '@/lib/supabase'
import type { AIConfigValue, AIModelStage, AIProviderKind, ConfigType, TaxRuleValue } from '@/lib/configs/types'
import { normalizeOpenAICompatibleBaseUrl } from '@/lib/ai/openai-compatible'
import { getAIConfigKind } from '@/lib/configs/ai-config-kind'

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
