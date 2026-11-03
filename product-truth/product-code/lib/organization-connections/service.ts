// REQ: F003 / WP50. Shared connection lifecycle; provider differences live in adapters.
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { getConnectionAdapter, adapters } from './adapters'
import { decryptConnectionPayload, encryptConnectionPayload, SHARED_ENVELOPE } from './crypto'
import { OrganizationConnectionError } from './errors'
import type {
  AdapterContext,
  ConfigurableProvider,
  ConnectionState,
  ConnectionSummary,
  DirectoryPreview,
  DraftCheckStatus,
  OrganizationConnectionProvider,
  ProviderCapability,
} from './types'

const COLUMNS = [
  'id', 'system_org_id', 'provider', 'external_tenant_id', 'priority', 'status',
  'authority_scope', 'sync_mode', 'configuration_revision', 'draft_credentials_ciphertext',
  'draft_credential_envelope', 'draft_credential_schema_version', 'draft_metadata',
  'draft_check_status', 'draft_checked_at', 'verification_started_at', 'effective_revision',
  'effective_credentials_ciphertext', 'effective_credential_envelope', 'effective_metadata',
  'connection_state', 'last_verified_at', 'last_error', 'last_error_at',
  'previous_effective_revision', 'previous_effective_credentials_ciphertext',
  'previous_effective_credential_envelope', 'previous_effective_metadata',
  'previous_effective_connection_state', 'lifecycle_audit', 'created_at', 'updated_at',
].join(',')

type ConnectionRow = {
  id: string
  system_org_id: string
  provider: ConfigurableProvider
  external_tenant_id: string
  priority: number
  status: 'draft' | 'active' | 'disabled'
  authority_scope: Record<string, unknown>
  sync_mode: 'read_only' | 'authoritative' | 'enrichment'
  configuration_revision: string
  draft_credentials_ciphertext: string | null
  draft_credential_envelope: string
  draft_credential_schema_version: number
  draft_metadata: Record<string, unknown>
  draft_check_status: DraftCheckStatus
  draft_checked_at: string | null
  verification_started_at: string | null
  effective_revision: string | null
  effective_credentials_ciphertext: string | null
  effective_credential_envelope: string | null
  effective_metadata: Record<string, unknown>
  connection_state: ConnectionState
  last_verified_at: string | null
  last_error: string | null
  last_error_at: string | null
  previous_effective_revision: string | null
  previous_effective_credentials_ciphertext: string | null
  previous_effective_credential_envelope: string | null
  previous_effective_metadata: Record<string, unknown>
  previous_effective_connection_state: ConnectionState | null
  lifecycle_audit: Array<Record<string, unknown>>
  created_at: string
  updated_at: string
}

type AuditEvent = {
  command: 'configured' | 'verified' | 'verification_failed' | 'promoted' | 'rolled_back' | 'disabled' | 'sync_failed' | 'sync_succeeded'
  actorId: string | null
  occurredAt: string
  configurationRevision?: string | null
  effectiveRevision?: string | null
  state?: ConnectionState
  detail?: string
}

function storageFailure() {
  return new OrganizationConnectionError('CONNECTION_STORAGE_UNAVAILABLE', '组织连接存储暂时不可用，请稍后重试。', 503)
}

function validateProvider(provider: string): ConfigurableProvider {
  if (provider !== 'feishu' && provider !== 'fxiaoke') {
    throw new OrganizationConnectionError('PROVIDER_NOT_CONFIGURABLE', '该组织提供方尚未接入连接配置。', 400)
  }
  return provider
}

function context(row: Pick<ConnectionRow, 'id' | 'provider' | 'system_org_id'>): AdapterContext & { sourceId: string; provider: ConfigurableProvider } {
  return { sourceId: row.id, provider: row.provider, systemOrgId: row.system_org_id }
}

function appendAudit(existing: unknown, event: AuditEvent) {
  const entries = Array.isArray(existing) ? existing.filter(item => item && typeof item === 'object') : []
  return [...entries.slice(-49), event]
}

function normalizeRow(value: unknown): ConnectionRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw storageFailure()
  return value as ConnectionRow
}

async function rowsForOrganization(orgId: string, provider: ConfigurableProvider) {
  const { data, error } = await supabaseAdmin
    .from('organization_sources')
    .select(COLUMNS)
    .eq('system_org_id', orgId)
    .eq('provider', provider)
  if (error) throw storageFailure()
  return (data || []).map(normalizeRow)
}

async function findConnectionRow(orgId: string, provider: ConfigurableProvider) {
  const rows = await rowsForOrganization(orgId, provider)
  const configured = rows.filter(row => Boolean(row.draft_credentials_ciphertext || row.effective_credentials_ciphertext))
  if (configured.length > 1) {
    throw new OrganizationConnectionError('CONNECTION_AMBIGUOUS', '当前组织存在多条同提供方连接配置，已停止自动选择。', 409)
  }
  if (configured[0]) return configured[0]
  if (rows.length > 1) {
    throw new OrganizationConnectionError('SOURCE_AMBIGUOUS', '当前组织存在多条该提供方来源，无法确定连接记录。', 409)
  }
  return rows[0] || null
}

async function rowBySource(orgId: string, provider: ConfigurableProvider, sourceId?: string) {
  const row = await findConnectionRow(orgId, provider)
  if (!row) return null
  if (sourceId && row.id !== sourceId) return null
  return row
}

function decryptDraft(row: ConnectionRow) {
  if (!row.draft_credentials_ciphertext) {
    throw new OrganizationConnectionError('CONFIGURATION_REQUIRED', '该组织连接尚未保存草稿配置。', 409)
  }
  const adapter = getConnectionAdapter(row.provider)
  return decryptConnectionPayload(context(row), row.draft_credentials_ciphertext, row.draft_credential_envelope, adapter)
}

function decryptEffective(row: ConnectionRow) {
  if (!row.effective_credentials_ciphertext || !row.effective_revision || !row.effective_credential_envelope) {
    throw new OrganizationConnectionError('CONFIGURATION_REQUIRED', '该组织连接尚无已验证的生效配置。', 409)
  }
  const adapter = getConnectionAdapter(row.provider)
  return decryptConnectionPayload(context(row), row.effective_credentials_ciphertext, row.effective_credential_envelope, adapter)
}

export function listOrganizationConnectionProviders(): ProviderCapability[] {
  const providers: OrganizationConnectionProvider[] = ['fxiaoke', 'feishu', 'wecom', 'dingtalk']
  return providers.map(provider => {
    if (provider === 'fxiaoke' || provider === 'feishu') {
      const adapter = adapters[provider]
      return {
        key: provider,
        label: adapter.label,
        configurable: true,
        previewAvailable: adapter.previewAvailable,
        syncAvailable: adapter.syncAvailable,
        fields: adapter.fields,
        unavailableReason: null,
      }
    }
    return {
      key: provider,
      label: provider === 'wecom' ? '企业微信' : '钉钉',
      configurable: false,
      previewAvailable: false,
      syncAvailable: false,
      fields: [],
      unavailableReason: '该组织提供方的连接器尚未接入统一配置。',
    }
  })
}

export function toConnectionSummary(row: ConnectionRow): ConnectionSummary {
  const metadata = row.draft_metadata && Object.keys(row.draft_metadata).length
    ? row.draft_metadata
    : row.effective_metadata || {}
  return {
    sourceId: row.id,
    provider: row.provider,
    externalTenantId: row.external_tenant_id,
    revision: row.configuration_revision,
    state: row.connection_state,
    draftCheckStatus: row.draft_check_status,
    configured: Boolean(row.draft_credentials_ciphertext || row.effective_credentials_ciphertext),
    effectiveVerified: Boolean(row.effective_revision && row.connection_state === 'verified' && row.status !== 'disabled'),
    metadata,
    lastCheckedAt: row.draft_checked_at,
    lastVerifiedAt: row.last_verified_at,
    lastError: row.last_error,
  }
}

export async function loadOrganizationConnection(orgId: string, rawProvider: string) {
  const provider = validateProvider(rawProvider)
  const row = await findConnectionRow(orgId, provider)
  return row ? toConnectionSummary(row) : null
}

export async function saveOrganizationConnection(input: {
  orgId: string
  actorId: string
  provider: string
  value: unknown
}) {
  const provider = validateProvider(input.provider)
  if (!input.value || typeof input.value !== 'object' || Array.isArray(input.value)) {
    throw new OrganizationConnectionError('INVALID_CONFIGURATION', '连接配置格式无效。', 400)
  }
  const raw = { ...(input.value as Record<string, unknown>) }
  const expectedRevision = raw.revision == null ? null : String(raw.revision)
  delete raw.revision
  const adapter = getConnectionAdapter(provider)
  adapter.parseInput(raw)
  const existing = await findConnectionRow(input.orgId, provider)
  if ((existing?.configuration_revision || null) !== expectedRevision) {
    throw new OrganizationConnectionError('CONFIG_CHANGED', '连接配置已被其他管理员更新，请重新读取后再保存。', 409)
  }
  let previous: Record<string, unknown> | null = null
  if (existing?.draft_credentials_ciphertext) previous = decryptDraft(existing)
  else if (existing?.effective_credentials_ciphertext) previous = decryptEffective(existing)
  const prepared = adapter.prepare(raw, previous, { systemOrgId: input.orgId })
  const sourceId = existing?.id || randomUUID()
  const configurationRevision = randomUUID()
  const now = new Date().toISOString()
  const ciphertext = encryptConnectionPayload(
    { sourceId, provider, systemOrgId: input.orgId },
    prepared.credentials,
  )
  const connectionState: ConnectionState = existing?.status === 'disabled'
    ? 'disabled'
    : existing?.effective_revision
      ? existing.connection_state
      : 'configured'
  const row = {
    system_org_id: input.orgId,
    provider,
    external_tenant_id: prepared.externalTenantId,
    configuration_revision: configurationRevision,
    draft_credentials_ciphertext: ciphertext,
    draft_credential_envelope: SHARED_ENVELOPE,
    draft_credential_schema_version: 1,
    draft_metadata: prepared.metadata,
    draft_check_status: 'not_checked',
    draft_checked_at: null,
    verification_started_at: null,
    connection_state: connectionState,
    last_error: null,
    last_error_at: null,
    lifecycle_audit: appendAudit(existing?.lifecycle_audit, {
      command: 'configured', actorId: input.actorId, occurredAt: now,
      configurationRevision, effectiveRevision: existing?.effective_revision || null,
      state: connectionState,
    }),
    updated_by: input.actorId,
    updated_at: now,
  }
  if (existing) {
    const result = await supabaseAdmin
      .from('organization_sources')
      .update(row)
      .eq('id', existing.id)
      .eq('system_org_id', input.orgId)
      .eq('configuration_revision', existing.configuration_revision)
      .select(COLUMNS)
      .maybeSingle()
    if (result.error?.code === '23505' || (!result.error && !result.data)) {
      throw new OrganizationConnectionError('CONFIG_CHANGED', '连接配置已被更新，请重新读取后再保存。', 409)
    }
    if (result.error || !result.data) throw storageFailure()
    return toConnectionSummary(normalizeRow(result.data))
  }

  const result = await supabaseAdmin
    .from('organization_sources')
    .insert({
      ...row,
      id: sourceId,
      priority: 100,
      status: 'draft',
      authority_scope: { identity: 'evidence', organization: 'evidence' },
      sync_mode: 'read_only',
      effective_revision: null,
      effective_credentials_ciphertext: null,
      effective_credential_envelope: null,
      effective_metadata: {},
      last_verified_at: null,
      previous_effective_revision: null,
      previous_effective_credentials_ciphertext: null,
      previous_effective_credential_envelope: null,
      previous_effective_metadata: {},
      previous_effective_connection_state: null,
      created_by: input.actorId,
    })
    .select(COLUMNS)
    .single()
  if (result.error?.code === '23505') {
    throw new OrganizationConnectionError('CONFIG_CHANGED', '该提供方已经存在连接配置，请刷新后继续。', 409)
  }
  if (result.error || !result.data) throw storageFailure()
  return toConnectionSummary(normalizeRow(result.data))
}

export async function previewOrganizationConnection(input: {
  orgId: string
  actorId: string
  provider: string
  revision: string
}): Promise<{ connection: ConnectionSummary; preview: DirectoryPreview }> {
  const provider = validateProvider(input.provider)
  const row = await rowBySource(input.orgId, provider)
  if (!row || row.configuration_revision !== input.revision) {
    throw new OrganizationConnectionError('CONFIG_CHANGED', '连接配置不存在或已修改，请重新读取后再验证。', 409)
  }
  const adapter = getConnectionAdapter(provider)
  const now = new Date()
  const cutoff = new Date(now.getTime() - 60_000).toISOString()
  const lease = await supabaseAdmin
    .from('organization_sources')
    .update({ verification_started_at: now.toISOString() })
    .eq('id', row.id)
    .eq('system_org_id', input.orgId)
    .eq('configuration_revision', input.revision)
    .or(`verification_started_at.is.null,verification_started_at.lt.${cutoff}`)
    .select('id')
    .maybeSingle()
  if (lease.error) throw storageFailure()
  if (!lease.data) throw new OrganizationConnectionError('PREVIEW_BUSY', '正在验证或刚刚读取过通讯录，请一分钟后再试。', 429)

  try {
    const credentials = decryptDraft(row)
    const verified = await adapter.verify(credentials, { systemOrgId: input.orgId })
    const verifiedCredentials = verified.credentialPatch ? { ...credentials, ...verified.credentialPatch } : credentials
    const ciphertext = verified.credentialPatch
      ? encryptConnectionPayload({ sourceId: row.id, provider, systemOrgId: input.orgId }, verifiedCredentials)
      : row.draft_credentials_ciphertext
    const metadata = { ...row.draft_metadata, ...(verified.metadata || {}) }
    const state: ConnectionState = row.status === 'disabled'
      ? 'disabled'
      : row.effective_revision
        ? row.connection_state
        : 'verified'
    const completedAt = new Date().toISOString()
    const result = await supabaseAdmin
      .from('organization_sources')
      .update({
        external_tenant_id: verified.externalTenantId,
        draft_credentials_ciphertext: ciphertext,
        draft_credential_envelope: SHARED_ENVELOPE,
        draft_metadata: metadata,
        draft_check_status: 'preview_ready',
        draft_checked_at: verified.checkedAt,
        verification_started_at: completedAt,
        connection_state: state,
        last_error: null,
        last_error_at: null,
        lifecycle_audit: appendAudit(row.lifecycle_audit, {
          command: 'verified', actorId: input.actorId, occurredAt: completedAt,
          configurationRevision: input.revision, effectiveRevision: row.effective_revision,
          state,
        }),
        updated_by: input.actorId,
        updated_at: completedAt,
      })
      .eq('id', row.id)
      .eq('system_org_id', input.orgId)
      .eq('configuration_revision', input.revision)
      .select(COLUMNS)
      .maybeSingle()
    if (result.error || !result.data) {
      throw new OrganizationConnectionError('CONFIG_CHANGED', '验证期间连接配置已改变，请重新验证。', 409)
    }
    return {
      connection: toConnectionSummary(normalizeRow(result.data)),
      preview: {
        checkedAt: verified.checkedAt,
        provider,
        externalTenantId: verified.externalTenantId,
        departments: verified.departments || [],
        employees: verified.employees || [],
        warnings: verified.warnings || [],
        applied: false,
      },
    }
  } catch (error) {
    const safe = error instanceof OrganizationConnectionError
      ? error
      : new OrganizationConnectionError('PREVIEW_FAILED', '连接验证失败，请检查配置后重试。', 502)
    const failedAt = new Date().toISOString()
    const failedState: ConnectionState = row.status === 'disabled'
      ? 'disabled'
      : row.effective_revision
        ? row.connection_state
        : 'failed'
    await supabaseAdmin
      .from('organization_sources')
      .update({
        draft_check_status: 'failed',
        draft_checked_at: failedAt,
        verification_started_at: null,
        connection_state: failedState,
        last_error: safe.message,
        last_error_at: failedAt,
        lifecycle_audit: appendAudit(row.lifecycle_audit, {
          command: 'verification_failed', actorId: input.actorId, occurredAt: failedAt,
          configurationRevision: input.revision, effectiveRevision: row.effective_revision,
          state: failedState, detail: safe.code,
        }),
        updated_by: input.actorId,
        updated_at: failedAt,
      })
      .eq('id', row.id)
      .eq('system_org_id', input.orgId)
      .eq('configuration_revision', input.revision)
    throw safe
  }
}

export async function loadVerifiedConnection(input: {
  orgId: string
  provider: string
  sourceId?: string
}) {
  const provider = validateProvider(input.provider)
  const row = await rowBySource(input.orgId, provider, input.sourceId)
  if (!row || !row.effective_revision) {
    throw new OrganizationConnectionError('CONFIGURATION_REQUIRED', '当前组织连接尚无已验证的生效配置，不能执行目录同步。', 409)
  }
  if (row.status === 'disabled') {
    throw new OrganizationConnectionError('SOURCE_DISABLED', '当前组织来源已停用，不能执行目录同步。', 409)
  }
  if (row.connection_state !== 'verified') {
    throw new OrganizationConnectionError('CONNECTION_NOT_VERIFIED', '当前组织连接尚未验证，不能执行目录同步。', 409)
  }
  return {
    sourceId: row.id,
    provider,
    revision: row.effective_revision,
    credentials: decryptEffective(row),
    summary: toConnectionSummary(row),
  }
}

export async function listVerifiedConnectionOrganizationIds(provider: ConfigurableProvider, limit = 10) {
  const { data, error } = await supabaseAdmin
    .from('organization_sources')
    .select(COLUMNS)
    .eq('provider', provider)
    .eq('connection_state', 'verified')
    .not('effective_revision', 'is', null)
    .neq('status', 'disabled')
    .order('updated_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 10)))
  if (error) throw storageFailure()
  return Array.from(new Set((data || []).map(normalizeRow).map(row => row.system_org_id)))
}

export async function promoteOrganizationConnection(input: {
  orgId: string
  actorId: string
  provider: string
  configurationRevision: string
}) {
  const provider = validateProvider(input.provider)
  const row = await rowBySource(input.orgId, provider)
  if (!row || row.configuration_revision !== input.configurationRevision) {
    throw new OrganizationConnectionError('CONFIG_CHANGED', '连接草稿已改变，请重新读取。', 409)
  }
  if (row.status === 'disabled') {
    throw new OrganizationConnectionError('SOURCE_DISABLED', '已停用的来源不能直接复活，请先完成新的切换预览。', 409)
  }
  if (!row.draft_credentials_ciphertext || row.draft_check_status !== 'preview_ready') {
    throw new OrganizationConnectionError('CONNECTION_NOT_VERIFIED', '连接草稿尚未验证，不能成为生效配置。', 409)
  }
  const now = new Date().toISOString()
  const result = await supabaseAdmin
    .from('organization_sources')
    .update({
      previous_effective_revision: row.effective_revision,
      previous_effective_credentials_ciphertext: row.effective_credentials_ciphertext,
      previous_effective_credential_envelope: row.effective_credential_envelope,
      previous_effective_metadata: row.effective_metadata,
      previous_effective_connection_state: row.effective_revision ? row.connection_state : null,
      effective_revision: row.configuration_revision,
      effective_credentials_ciphertext: row.draft_credentials_ciphertext,
      effective_credential_envelope: row.draft_credential_envelope,
      effective_metadata: row.draft_metadata,
      connection_state: 'verified',
      last_verified_at: row.draft_checked_at || now,
      lifecycle_audit: appendAudit(row.lifecycle_audit, {
        command: 'promoted', actorId: input.actorId, occurredAt: now,
        configurationRevision: row.configuration_revision, effectiveRevision: row.configuration_revision,
        state: 'verified',
      }),
      updated_by: input.actorId,
      updated_at: now,
    })
    .eq('id', row.id)
    .eq('system_org_id', input.orgId)
    .eq('configuration_revision', input.configurationRevision)
    .select(COLUMNS)
    .maybeSingle()
  if (result.error || !result.data) throw new OrganizationConnectionError('CONFIG_CHANGED', '生效配置切换失败，连接没有改变。', 409)
  return toConnectionSummary(normalizeRow(result.data))
}

export async function rollbackOrganizationConnection(input: {
  orgId: string
  actorId: string
  provider: string
  effectiveRevision: string
}) {
  const provider = validateProvider(input.provider)
  const row = await rowBySource(input.orgId, provider)
  if (!row || row.effective_revision !== input.effectiveRevision || !row.previous_effective_revision) {
    throw new OrganizationConnectionError('ROLLBACK_UNAVAILABLE', '没有可原子回滚的上一生效配置。', 409)
  }
  const now = new Date().toISOString()
  const result = await supabaseAdmin
    .from('organization_sources')
    .update({
      effective_revision: row.previous_effective_revision,
      effective_credentials_ciphertext: row.previous_effective_credentials_ciphertext,
      effective_credential_envelope: row.previous_effective_credential_envelope,
      effective_metadata: row.previous_effective_metadata,
      connection_state: row.previous_effective_connection_state || 'configured',
      last_verified_at: now,
      lifecycle_audit: appendAudit(row.lifecycle_audit, {
        command: 'rolled_back', actorId: input.actorId, occurredAt: now,
        configurationRevision: row.configuration_revision,
        effectiveRevision: row.previous_effective_revision,
        state: row.previous_effective_connection_state || 'configured',
      }),
      updated_by: input.actorId,
      updated_at: now,
    })
    .eq('id', row.id)
    .eq('system_org_id', input.orgId)
    .eq('effective_revision', input.effectiveRevision)
    .select(COLUMNS)
    .maybeSingle()
  if (result.error || !result.data) throw new OrganizationConnectionError('ROLLBACK_FAILED', '上一生效配置已改变，回滚未执行。', 409)
  return toConnectionSummary(normalizeRow(result.data))
}

export function legacyFeishuMigrationAvailable() {
  return Boolean(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET)
}

export async function migrateLegacyFeishuConnection(orgId: string, actorId: string) {
  const appId = process.env.FEISHU_APP_ID
  const appSecret = process.env.FEISHU_APP_SECRET
  if (!appId || !appSecret) {
    throw new OrganizationConnectionError('LEGACY_CONFIGURATION_MISSING', '没有可导入的旧飞书环境配置。', 404)
  }
  const existing = await loadOrganizationConnection(orgId, 'feishu')
  if (existing?.configured) {
    throw new OrganizationConnectionError(
      'LEGACY_CONFIGURATION_ALREADY_IMPORTED',
      '当前组织已有飞书共享连接草稿；请直接编辑草稿，不再重复导入部署环境配置。',
      409,
    )
  }
  return saveOrganizationConnection({
    orgId,
    actorId,
    provider: 'feishu',
    value: { appId, appSecret, revision: existing?.revision || null },
  })
}
