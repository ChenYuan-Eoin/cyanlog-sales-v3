// REQ: F003 / WP50. Shared connection lifecycle; provider differences live in adapters.
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import {
  getConnectionAdapter,
  getDirectoryAdapter,
  getProviderAdapterCapabilities,
  isConfigurableProvider,
  listProviderCatalog,
} from './adapters'
import { decryptConnectionPayload, encryptConnectionPayload, SHARED_ENVELOPE } from './crypto'
import { OrganizationConnectionError } from './errors'
import {
  assertUnifiedConnectionStorage,
  detectConnectionStorageMode,
  isMissingSchemaObject,
  type ConnectionStorageMode,
} from './storage'
import type {
  AdapterContext,
  OrganizationConnectionProvider,
  ConnectionState,
  ConnectionSummary,
  DirectoryPreview,
  DraftCheckStatus,
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

const LEGACY_SOURCE_COLUMNS = [
  'id', 'system_org_id', 'provider', 'external_tenant_id', 'priority', 'status',
  'authority_scope', 'sync_mode', 'last_successful_sync_at', 'last_error',
  'created_at', 'updated_at',
].join(',')

const LEGACY_FXIAOKE_COLUMNS = [
  'system_org_id', 'app_id', 'expected_ea', 'api_user_id', 'credentials_ciphertext',
  'revision', 'last_checked_at', 'last_check_status', 'last_error',
  'preview_started_at', 'updated_by', 'updated_at',
].join(',')

type ConnectionRow = {
  id: string
  system_org_id: string
  provider: OrganizationConnectionProvider
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

type StoredConnectionRow = ConnectionRow & {
  storage_mode: ConnectionStorageMode
}

type LegacySourceRow = {
  id: string
  system_org_id: string
  provider: OrganizationConnectionProvider
  external_tenant_id: string
  priority: number
  status: 'draft' | 'active' | 'disabled'
  authority_scope: Record<string, unknown>
  sync_mode: 'read_only' | 'authoritative' | 'enrichment'
  last_successful_sync_at: string | null
  last_error: string | null
  created_at: string
  updated_at: string
}

type LegacyFxiaokeRow = {
  system_org_id: string
  app_id: string
  expected_ea: string
  api_user_id: string
  credentials_ciphertext: string
  revision: string
  last_checked_at: string | null
  last_check_status: 'not_checked' | 'preview_ready' | 'failed'
  last_error: string | null
  preview_started_at: string | null
  updated_by: string | null
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

function validateProvider(provider: string): OrganizationConnectionProvider {
  if (!isConfigurableProvider(provider)) {
    throw new OrganizationConnectionError('PROVIDER_NOT_CONFIGURABLE', '该组织提供方尚未接入连接配置。', 400)
  }
  return provider
}

function context(row: Pick<ConnectionRow, 'id' | 'provider' | 'system_org_id'>): AdapterContext & { sourceId: string; provider: OrganizationConnectionProvider } {
  return { sourceId: row.id, provider: row.provider, systemOrgId: row.system_org_id }
}

function appendAudit(existing: unknown, event: AuditEvent) {
  const entries = Array.isArray(existing) ? existing.filter(item => item && typeof item === 'object') : []
  return [...entries.slice(-49), event]
}

function normalizeRow(value: unknown, storageMode: ConnectionStorageMode = 'unified'): StoredConnectionRow {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw storageFailure()
  return { ...(value as ConnectionRow), storage_mode: storageMode }
}

export function mapLegacyFxiaokeConnectionRow(source: LegacySourceRow, legacy: LegacyFxiaokeRow): StoredConnectionRow {
  const sameTenantKey = source.external_tenant_id === legacy.expected_ea
  // Legacy sources may store corpId while the saved application uses EA. This
  // projection only exposes the existing configuration; it grants no validity.
  // The active read must prove both identifiers in one provider response.
  const differentIdentifierKinds = source.external_tenant_id.startsWith('FSCID_')
    && Boolean(legacy.expected_ea)
    && !legacy.expected_ea.startsWith('FSCID_')
    && !legacy.expected_ea.startsWith('pending-')
  if (source.system_org_id !== legacy.system_org_id || (!sameTenantKey && !differentIdentifierKinds)) {
    throw new OrganizationConnectionError(
      'CONNECTION_AMBIGUOUS',
      '旧纷享连接与当前企业来源不一致，已停止自动选择。',
      409,
    )
  }
  const draftCheckStatus = sameTenantKey ? legacy.last_check_status : 'not_checked'
  const verified = draftCheckStatus === 'preview_ready' && source.status !== 'disabled'
  const connectionState: ConnectionState = source.status === 'disabled'
    ? 'disabled'
    : verified
      ? 'verified'
      : draftCheckStatus === 'failed'
        ? 'failed'
        : 'configured'
  const metadata = {
    appId: legacy.app_id,
    apiUserId: legacy.api_user_id,
    expectedEa: legacy.expected_ea,
  }
  return {
    id: source.id,
    system_org_id: source.system_org_id,
    provider: source.provider,
    external_tenant_id: source.external_tenant_id,
    priority: source.priority,
    status: source.status,
    authority_scope: source.authority_scope,
    sync_mode: source.sync_mode,
    configuration_revision: legacy.revision,
    draft_credentials_ciphertext: legacy.credentials_ciphertext,
    draft_credential_envelope: 'legacy-fxiaoke-v1',
    draft_credential_schema_version: 1,
    draft_metadata: metadata,
    draft_check_status: draftCheckStatus,
    draft_checked_at: legacy.last_checked_at,
    verification_started_at: legacy.preview_started_at,
    effective_revision: verified ? legacy.revision : null,
    effective_credentials_ciphertext: verified ? legacy.credentials_ciphertext : null,
    effective_credential_envelope: verified ? 'legacy-fxiaoke-v1' : null,
    effective_metadata: verified ? metadata : {},
    connection_state: connectionState,
    last_verified_at: verified ? legacy.last_checked_at : null,
    last_error: legacy.last_error || source.last_error,
    last_error_at: draftCheckStatus === 'failed' ? legacy.last_checked_at : null,
    previous_effective_revision: null,
    previous_effective_credentials_ciphertext: null,
    previous_effective_credential_envelope: null,
    previous_effective_metadata: {},
    previous_effective_connection_state: null,
    lifecycle_audit: [],
    created_at: source.created_at,
    updated_at: legacy.updated_at || source.updated_at,
    storage_mode: 'legacy_fxiaoke_read_only',
  }
}

function assertVerifiedTenant(row: StoredConnectionRow, verification: {
  externalTenantId: string
  verifiedTenantIds?: string[]
}) {
  const verifiedIds = [verification.externalTenantId, ...(verification.verifiedTenantIds || [])]
  const legacyEaMatches = row.storage_mode !== 'legacy_fxiaoke_read_only'
    || row.draft_metadata.expectedEa === verification.externalTenantId
  if (!legacyEaMatches || !verifiedIds.includes(row.external_tenant_id)) {
    throw new OrganizationConnectionError('ENTERPRISE_MISMATCH', '读取到的企业与保存的连接不一致，本次核验结果已拒绝。', 409)
  }
}

async function legacyRowsForOrganization(orgId: string, provider: OrganizationConnectionProvider) {
  if (provider !== 'fxiaoke') return []
  const sourceResult = await supabaseAdmin
    .from('organization_sources')
    .select(LEGACY_SOURCE_COLUMNS)
    .eq('system_org_id', orgId)
    .eq('provider', provider)
  if (sourceResult.error) throw storageFailure()
  const sources = (sourceResult.data || []).map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw storageFailure()
    return value as LegacySourceRow
  })
  if (sources.length === 0) return []

  const legacyResult = await supabaseAdmin
    .from('organization_fxiaoke_connections')
    .select(LEGACY_FXIAOKE_COLUMNS)
    .eq('system_org_id', orgId)
    .maybeSingle()
  if (legacyResult.error) throw storageFailure()
  if (!legacyResult.data) return []
  const legacy = legacyResult.data as unknown as LegacyFxiaokeRow
  return sources.map(source => mapLegacyFxiaokeConnectionRow(source, legacy))
}

async function rowsForOrganization(orgId: string, provider: OrganizationConnectionProvider) {
  const storageMode = await detectConnectionStorageMode()
  if (storageMode !== 'unified') return legacyRowsForOrganization(orgId, provider)
  const { data, error } = await supabaseAdmin
    .from('organization_sources')
    .select(COLUMNS)
    .eq('system_org_id', orgId)
    .eq('provider', provider)
  if (error) throw storageFailure()
  return (data || []).map(value => normalizeRow(value, 'unified'))
}

async function findConnectionRow(orgId: string, provider: OrganizationConnectionProvider) {
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

async function rowBySource(orgId: string, provider: OrganizationConnectionProvider, sourceId?: string) {
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
  return listProviderCatalog().map(entry => {
    const capabilities = getProviderAdapterCapabilities(entry.key)
    const adapter = capabilities.credentialVerification ? getConnectionAdapter(entry.key) : null
    return {
      key: entry.key,
      label: entry.label,
      configurable: capabilities.credentialVerification,
      previewAvailable: capabilities.directoryPreview,
      syncAvailable: capabilities.directoryPreview,
      ssoAvailable: capabilities.enterpriseLogin,
      capabilities,
      fields: adapter?.fields ?? [],
      unavailableReason: adapter ? null : entry.unavailableReason,
    } satisfies ProviderCapability
  })
}

export function toConnectionSummary(row: StoredConnectionRow): ConnectionSummary {
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
    effectiveRevision: row.effective_revision,
    metadata,
    lastCheckedAt: row.draft_checked_at,
    lastVerifiedAt: row.last_verified_at,
    lastError: row.last_error,
    storageMode: row.storage_mode,
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
  await assertUnifiedConnectionStorage()
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
    external_tenant_id: provider === 'fxiaoke' && existing?.effective_revision
      ? existing.external_tenant_id
      : prepared.externalTenantId,
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

async function previewLegacyReadOnlyConnection(
  row: StoredConnectionRow,
  input: { orgId: string; provider: OrganizationConnectionProvider },
): Promise<{ connection: ConnectionSummary; preview: DirectoryPreview }> {
  const connectionAdapter = getConnectionAdapter(input.provider)
  const directoryAdapter = getDirectoryAdapter(input.provider)
  let connectionVerified = false
  try {
    const credentials = decryptDraft(row)
    const verification = await connectionAdapter.verifyConnection(credentials, { systemOrgId: input.orgId })
    assertVerifiedTenant(row, verification)
    connectionVerified = true
    const verifiedCredentials = verification.credentialPatch
      ? { ...credentials, ...verification.credentialPatch }
      : credentials
    const directory = await directoryAdapter.readDirectory(verifiedCredentials, { systemOrgId: input.orgId })
    const state: ConnectionState = row.status === 'disabled'
      ? 'disabled'
      : row.effective_revision
        ? row.connection_state
        : 'verified'
    return {
      connection: toConnectionSummary({
        ...row,
        external_tenant_id: row.external_tenant_id,
        draft_metadata: { ...row.draft_metadata, ...(verification.metadata || {}) },
        draft_check_status: 'preview_ready',
        draft_checked_at: directory.checkedAt,
        connection_state: state,
        last_verified_at: verification.checkedAt,
        last_error: null,
        last_error_at: null,
      }),
      preview: {
        checkedAt: directory.checkedAt,
        provider: input.provider,
        externalTenantId: row.external_tenant_id,
        complete: directory.complete,
        scopeVerified: directory.scopeVerified,
        scopeEvidence: directory.scopeEvidence,
        departments: directory.departments,
        employees: directory.employees,
        warnings: directory.warnings,
        applied: false,
      },
    }
  } catch (error) {
    if (error instanceof OrganizationConnectionError) throw error
    throw new OrganizationConnectionError(
      connectionVerified ? 'DIRECTORY_READ_FAILED' : 'CONNECTION_VERIFICATION_FAILED',
      connectionVerified ? '应用连接已通过，但通讯录读取失败，请检查目录权限。' : '连接验证失败，请检查配置后重试。',
      502,
    )
  }
}

/** WP51: does not persist connection verification or organization business data.
 * Existing provider transport may use its established transient request queue.
 */
export async function readOrganizationDirectory(input: {
  orgId: string
  provider: string
  sourceId: string
  revision: string
  credentialSource?: 'effective'
}) {
  const provider = validateProvider(input.provider)
  const row = await rowBySource(input.orgId, provider)
  const effective = input.credentialSource === 'effective'
  const verifiedRevision = effective ? row?.effective_revision : row?.configuration_revision
  if (!row || row.id !== input.sourceId || verifiedRevision !== input.revision) {
    throw new OrganizationConnectionError('CONFIG_CHANGED', '连接配置已改变，请刷新后重新核验。', 409)
  }
  if (effective && (row.status !== 'active' || row.connection_state !== 'verified')) {
    throw new OrganizationConnectionError('CONNECTION_NOT_VERIFIED', '当前组织连接尚无已验证的生效配置。', 409)
  }
  const connectionAdapter = getConnectionAdapter(provider)
  const directoryAdapter = getDirectoryAdapter(provider)
  const credentials = effective ? decryptEffective(row) : decryptDraft(row)
  const verification = await connectionAdapter.verifyConnection(credentials, { systemOrgId: input.orgId })
  assertVerifiedTenant(row, verification)
  const directory = await directoryAdapter.readDirectory(
    { ...credentials, ...(verification.credentialPatch || {}) },
    { systemOrgId: input.orgId },
  )
  const current = await rowBySource(input.orgId, provider)
  const credentialChanged = effective
    ? current?.effective_revision !== row.effective_revision
      || current?.effective_credentials_ciphertext !== row.effective_credentials_ciphertext
      || current?.effective_credential_envelope !== row.effective_credential_envelope
    : current?.draft_credentials_ciphertext !== row.draft_credentials_ciphertext
      || current?.draft_credential_envelope !== row.draft_credential_envelope
  if (!current || current.id !== row.id || current.configuration_revision !== row.configuration_revision
    || current.external_tenant_id !== row.external_tenant_id || current.status !== row.status
    || current.connection_state !== row.connection_state
    || current.updated_at !== row.updated_at || current.storage_mode !== row.storage_mode
    || credentialChanged) {
    throw new OrganizationConnectionError('CONFIG_CHANGED', '读取期间连接或来源发生变化，本次结果已失效，请重新核验。', 409)
  }
  return {
    binding: {
      organizationId: input.orgId, sourceId: row.id, provider,
      externalTenantId: row.external_tenant_id,
      connectionRevision: input.revision,
      sourceState: row.connection_state,
    },
    verifiedTenantIds: verification.verifiedTenantIds ?? [verification.externalTenantId],
    sourceUpdatedAt: row.updated_at,
    sourceConfigurationRevision: row.configuration_revision,
    directory: {
      ...directory,
      departments: directory.departments.map(department => ({ ...department, status: directoryAdapter.normalizeDirectoryStatus(department.status) })),
      employees: directory.employees.map(employee => ({ ...employee, status: directoryAdapter.normalizeDirectoryStatus(employee.status) })),
    },
  }
}

export async function inspectOrganizationDirectory(input: Parameters<typeof readOrganizationDirectory>[0]) {
  const { buildDirectoryInspection } = await import('./directory-inspection')
  const { binding, directory } = await readOrganizationDirectory(input)
  return buildDirectoryInspection(binding, directory)
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
  if (row.storage_mode === 'legacy_fxiaoke_read_only') {
    return previewLegacyReadOnlyConnection(row, { orgId: input.orgId, provider })
  }
  const connectionAdapter = getConnectionAdapter(provider)
  const directoryAdapter = getDirectoryAdapter(provider)
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

  let connectionVerified = false
  let audit = row.lifecycle_audit
  try {
    const credentials = decryptDraft(row)
    const verification = await connectionAdapter.verifyConnection(credentials, { systemOrgId: input.orgId })
    if (provider === 'fxiaoke' && row.effective_revision) assertVerifiedTenant(row, verification)
    connectionVerified = true
    const verifiedCredentials = verification.credentialPatch
      ? { ...credentials, ...verification.credentialPatch }
      : credentials
    const ciphertext = verification.credentialPatch
      ? encryptConnectionPayload({ sourceId: row.id, provider, systemOrgId: input.orgId }, verifiedCredentials)
      : row.draft_credentials_ciphertext
    const metadata = { ...row.draft_metadata, ...(verification.metadata || {}) }
    const state: ConnectionState = row.status === 'disabled'
      ? 'disabled'
      : row.effective_revision
        ? row.connection_state
        : 'verified'
    const connectionCheckedAt = verification.checkedAt

    // Persist credential validity before the directory operation. A missing
    // contact permission must not turn a valid application connection into a
    // credential failure.
    const connectionResult = await supabaseAdmin
      .from('organization_sources')
      .update({
        external_tenant_id: provider === 'fxiaoke' && row.effective_revision
          ? row.external_tenant_id
          : verification.externalTenantId,
        draft_credentials_ciphertext: ciphertext,
        draft_credential_envelope: SHARED_ENVELOPE,
        draft_metadata: metadata,
        draft_check_status: 'not_checked',
        draft_checked_at: connectionCheckedAt,
        connection_state: state,
        last_verified_at: row.effective_revision ? row.last_verified_at : connectionCheckedAt,
        last_error: null,
        last_error_at: null,
        lifecycle_audit: appendAudit(row.lifecycle_audit, {
          command: 'verified', actorId: input.actorId, occurredAt: connectionCheckedAt,
          configurationRevision: input.revision, effectiveRevision: row.effective_revision,
          state,
        }),
        updated_by: input.actorId,
        updated_at: connectionCheckedAt,
      })
      .eq('id', row.id)
      .eq('system_org_id', input.orgId)
      .eq('configuration_revision', input.revision)
      .select(COLUMNS)
      .maybeSingle()
    if (connectionResult.error || !connectionResult.data) {
      throw new OrganizationConnectionError('CONFIG_CHANGED', '验证期间连接配置已改变，请重新验证。', 409)
    }
    const connectionRow = normalizeRow(connectionResult.data)
    audit = connectionRow.lifecycle_audit

    const directory = await directoryAdapter.readDirectory(verifiedCredentials, { systemOrgId: input.orgId })
    const completedAt = new Date().toISOString()
    const result = await supabaseAdmin
      .from('organization_sources')
      .update({
        draft_check_status: 'preview_ready',
        draft_checked_at: directory.checkedAt,
        verification_started_at: completedAt,
        last_error: null,
        last_error_at: null,
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
        checkedAt: directory.checkedAt,
        provider,
        externalTenantId: verification.externalTenantId,
        complete: directory.complete,
        scopeVerified: directory.scopeVerified,
        scopeEvidence: directory.scopeEvidence,
        departments: directory.departments,
        employees: directory.employees,
        warnings: directory.warnings,
        applied: false,
      },
    }
  } catch (error) {
    const safe = error instanceof OrganizationConnectionError
      ? error
      : new OrganizationConnectionError(
          connectionVerified ? 'DIRECTORY_READ_FAILED' : 'CONNECTION_VERIFICATION_FAILED',
          connectionVerified ? '应用连接已通过，但通讯录读取失败，请检查目录权限。' : '连接验证失败，请检查配置后重试。',
          502,
        )
    const failedAt = new Date().toISOString()
    const failedState: ConnectionState = row.status === 'disabled'
      ? 'disabled'
      : connectionVerified && !row.effective_revision
        ? 'verified'
        : row.connection_state
    await supabaseAdmin
      .from('organization_sources')
      .update({
        draft_check_status: 'failed',
        draft_checked_at: failedAt,
        verification_started_at: null,
        connection_state: failedState,
        last_error: safe.message,
        last_error_at: failedAt,
        lifecycle_audit: appendAudit(audit, {
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

// Narrow read-only credential access for administrator-controlled integration
// schema inspection. It never enables a disabled source, refreshes a directory,
// or changes connection state; the provider tenant is re-verified by the caller.
export async function loadVerifiedConfigurationForReadOnlyMetadata(input: {
  orgId: string
  provider: string
  purpose: 'read_only_metadata_inspection'
}) {
  const provider = validateProvider(input.provider)
  const row = await rowBySource(input.orgId, provider)
  const verifiedEvidence = Boolean(
    row
    && (
      (row.effective_revision && row.effective_credentials_ciphertext)
      || row.draft_check_status === 'preview_ready'
    )
  )
  if (!row || !verifiedEvidence) {
    throw new OrganizationConnectionError('CONFIGURATION_REQUIRED', '当前组织连接尚无已核验配置，不能读取对象元数据。', 409)
  }
  return {
    sourceId: row.id,
    provider,
    revision: row.effective_revision || row.configuration_revision,
    sourceStatus: row.status,
    credentials: row.effective_credentials_ciphertext ? decryptEffective(row) : decryptDraft(row),
    summary: toConnectionSummary(row),
  }
}

export async function loadFxiaokeRotationDraft(input: { orgId: string; sourceId: string; revision: string; sourceUpdatedAt: string }) {
  const row = await rowBySource(input.orgId, 'fxiaoke', input.sourceId)
  if (!row || row.status !== 'active' || row.connection_state !== 'verified'
    || row.configuration_revision !== input.revision || row.draft_check_status !== 'preview_ready'
    || !row.effective_revision || row.effective_revision === input.revision
    || row.updated_at !== input.sourceUpdatedAt || !hasIdentityAuthority(row.authority_scope)) {
    throw new OrganizationConnectionError('CONFIG_CHANGED', '纷享凭证验证已失效，请重新发起。', 409)
  }
  return decryptDraft(row)
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

async function legacyVerifiedOrganizationIds(
  provider: OrganizationConnectionProvider,
  limit: number,
  identityAuthorityOnly: boolean,
) {
  if (provider !== 'fxiaoke') return []
  let sourceQuery = supabaseAdmin
    .from('organization_sources')
    .select(LEGACY_SOURCE_COLUMNS)
    .eq('provider', provider)
    .neq('status', 'disabled')
    .order('updated_at', { ascending: false })
    .limit(100)
  if (identityAuthorityOnly) sourceQuery = sourceQuery.eq('status', 'active')
  const sourceResult = await sourceQuery
  if (sourceResult.error) throw storageFailure()
  const sourceIds = Array.from(new Set((sourceResult.data || [])
    .filter(value => value && typeof value === 'object' && !Array.isArray(value))
    .map(value => value as LegacySourceRow)
    .filter(source => !identityAuthorityOnly || hasIdentityAuthority(source.authority_scope))
    .map(source => source.system_org_id)))
  if (sourceIds.length === 0) return []
  const legacyResult = await supabaseAdmin
    .from('organization_fxiaoke_connections')
    .select('system_org_id')
    .in('system_org_id', sourceIds)
    .eq('last_check_status', 'preview_ready')
    .order('updated_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 10)))
  if (legacyResult.error) throw storageFailure()
  return Array.from(new Set((legacyResult.data || [])
    .map(value => value && typeof value === 'object' && !Array.isArray(value)
      ? (value as { system_org_id?: unknown }).system_org_id
      : null)
    .filter((value): value is string => typeof value === 'string')))
}

export async function listVerifiedConnectionOrganizationIds(provider: OrganizationConnectionProvider, limit = 10) {
  const boundedLimit = Math.max(1, Math.min(limit, 10))
  if (await detectConnectionStorageMode() !== 'unified') {
    return legacyVerifiedOrganizationIds(provider, boundedLimit, false)
  }
  const { data, error } = await supabaseAdmin
    .from('organization_sources')
    .select(COLUMNS)
    .eq('provider', provider)
    .eq('connection_state', 'verified')
    .not('effective_revision', 'is', null)
    .neq('status', 'disabled')
    .order('updated_at', { ascending: false })
    .limit(boundedLimit)
  if (error) throw storageFailure()
  return Array.from(new Set((data || []).map(value => normalizeRow(value)).map(row => row.system_org_id)))
}

export function hasIdentityAuthority(authorityScope: unknown) {
  return Boolean(
    authorityScope
    && typeof authorityScope === 'object'
    && !Array.isArray(authorityScope)
    && (authorityScope as Record<string, unknown>).identity === 'authoritative',
  )
}

export async function listIdentityLoginConnections(provider: OrganizationConnectionProvider, limit = 2) {
  const boundedLimit = Math.max(1, Math.min(limit, 10))
  const { data, error } = await supabaseAdmin.from('organization_sources')
    .select(COLUMNS)
    .eq('provider', provider)
    .eq('status', 'active')
    .eq('connection_state', 'verified')
    .eq('authority_scope->>identity', 'authoritative')
    .not('effective_revision', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(boundedLimit)
  if (error) {
    if (!isMissingSchemaObject(error) || await detectConnectionStorageMode() !== 'legacy_fxiaoke_read_only') {
      throw storageFailure()
    }
    const ids = await legacyVerifiedOrganizationIds(provider, boundedLimit, true)
    return ids.map(orgId => ({
      orgId,
      read: async () => {
        const { revision, credentials } = await loadVerifiedConnection({ orgId, provider })
        return { revision, credentials }
      },
    }))
  }
  // Decrypt only after the caller has verified that exactly one tenant is eligible.
  return (data || []).map(value => normalizeRow(value))
    .filter((row): row is StoredConnectionRow & { effective_revision: string } =>
      row.status === 'active' && row.connection_state === 'verified' &&
      typeof row.effective_revision === 'string' && hasIdentityAuthority(row.authority_scope))
    .map(row => ({
      orgId: row.system_org_id,
      read: () => ({ revision: row.effective_revision, credentials: decryptEffective(row) }),
    }))
}

function requireReviewedFxiaokeCredentialReplacement(row: ConnectionRow) {
  if (row.provider === 'fxiaoke' && row.status === 'active' && row.connection_state === 'verified'
    && row.effective_revision && row.configuration_revision !== row.effective_revision
    && hasIdentityAuthority(row.authority_scope)) {
    throw new OrganizationConnectionError(
      'SSO_REPLACEMENT_REQUIRES_VERIFICATION',
      '纷享登录已开启。更换共享凭证需先验证真实员工登录，本次保留原生效连接。',
      409,
    )
  }
}

/** Explicit directory activation. A dormant identity authority must not become
 * usable merely because directory credentials are enabled. */
export async function activateDirectoryConnection(input: {
  orgId: string
  actorId: string
  provider: string
  configurationRevision: string
}) {
  await assertUnifiedConnectionStorage()
  const provider = validateProvider(input.provider)
  const row = await rowBySource(input.orgId, provider)
  if (!row || row.configuration_revision !== input.configurationRevision) {
    throw new OrganizationConnectionError('CONFIG_CHANGED', '连接草稿已改变，请刷新后重新验证。', 409)
  }
  if (!row.draft_credentials_ciphertext || row.draft_check_status !== 'preview_ready') {
    throw new OrganizationConnectionError('CONNECTION_NOT_VERIFIED', '请先检查连接与读取范围，再启用目录连接。', 409)
  }
  if (row.status === 'active' && row.connection_state === 'verified'
    && row.effective_revision === row.configuration_revision) return toConnectionSummary(row)
  requireReviewedFxiaokeCredentialReplacement(row)

  const identityWasEffective = row.status === 'active' && row.connection_state === 'verified'
    && Boolean(row.effective_revision && row.effective_credentials_ciphertext)
  const authorityScope = { ...row.authority_scope }
  if (!identityWasEffective && hasIdentityAuthority(authorityScope)) authorityScope.identity = 'evidence'
  const now = new Date().toISOString()
  const result = await supabaseAdmin.from('organization_sources').update({
    status: 'active',
    authority_scope: authorityScope,
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
    last_error: null,
    last_error_at: null,
    lifecycle_audit: appendAudit(row.lifecycle_audit, {
      command: 'promoted', actorId: input.actorId, occurredAt: now,
      configurationRevision: row.configuration_revision, effectiveRevision: row.configuration_revision,
      state: 'verified', detail: 'directory_connection_enabled',
    }),
    updated_by: input.actorId,
    updated_at: now,
  }).eq('id', row.id).eq('system_org_id', input.orgId)
    .eq('configuration_revision', input.configurationRevision)
    .eq('updated_at', row.updated_at)
    .select(COLUMNS).maybeSingle()
  if (result.error || !result.data) {
    throw new OrganizationConnectionError('CONFIG_CHANGED', '连接在启用前已改变，本次没有生效，请刷新后重试。', 409)
  }
  return toConnectionSummary(normalizeRow(result.data))
}

export async function promoteOrganizationConnection(input: {
  orgId: string
  actorId: string
  provider: string
  configurationRevision: string
}) {
  await assertUnifiedConnectionStorage()
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
  requireReviewedFxiaokeCredentialReplacement(row)
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
  await assertUnifiedConnectionStorage()
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
