import { supabaseAdmin } from '@/lib/supabase'

export type OrganizationSourceStatus = 'draft' | 'active' | 'disabled'
export type OrganizationSource = {
  id: string
  systemOrgId: string
  provider: string
  externalTenantId: string
  priority: number
  status: OrganizationSourceStatus
  authorityScope: Record<string, unknown>
  syncMode: 'read_only' | 'authoritative' | 'enrichment'
  lastSuccessfulSyncAt: string | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export type OrganizationSourceProvider = {
  key: 'feishu' | 'wecom' | 'dingtalk'
  label: string
  syncAvailable: boolean
  unavailableReason: string | null
}

export class OrganizationSourceError extends Error {
  readonly code:
    | 'SOURCE_REQUIRED'
    | 'SOURCE_INVALID'
    | 'SOURCE_AMBIGUOUS'
  readonly status: 400 | 404 | 409 | 503

  constructor(
    code: 'SOURCE_REQUIRED' | 'SOURCE_INVALID' | 'SOURCE_AMBIGUOUS',
    message: string,
    status: 400 | 404 | 409 | 503 = 409,
  ) {
    super(message)
    this.name = 'OrganizationSourceError'
    this.code = code
    this.status = status
  }
}

function normalizeSource(value: unknown): OrganizationSource | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (
    typeof row.id !== 'string'
    || typeof row.system_org_id !== 'string'
    || typeof row.provider !== 'string'
    || typeof row.external_tenant_id !== 'string'
    || !Number.isInteger(row.priority)
    || !['draft', 'active', 'disabled'].includes(String(row.status))
    || !['read_only', 'authoritative', 'enrichment'].includes(String(row.sync_mode))
  ) {
    return null
  }

  return {
    id: row.id,
    systemOrgId: row.system_org_id,
    provider: row.provider,
    externalTenantId: row.external_tenant_id,
    priority: row.priority as number,
    status: row.status as OrganizationSourceStatus,
    authorityScope: row.authority_scope && typeof row.authority_scope === 'object'
      ? row.authority_scope as Record<string, unknown>
      : {},
    syncMode: row.sync_mode as OrganizationSource['syncMode'],
    lastSuccessfulSyncAt: typeof row.last_successful_sync_at === 'string' ? row.last_successful_sync_at : null,
    lastError: typeof row.last_error === 'string' ? row.last_error : null,
    createdAt: typeof row.created_at === 'string' ? row.created_at : '',
    updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '',
  }
}

export function listOrganizationSourceProviders(
  env: Record<string, string | undefined> = process.env,
): OrganizationSourceProvider[] {
  const feishuConfigured = Boolean(env.FEISHU_APP_ID && env.FEISHU_APP_SECRET)
  return [
    {
      key: 'feishu',
      label: '飞书',
      syncAvailable: feishuConfigured,
      unavailableReason: feishuConfigured ? null : '飞书应用凭据尚未配置，只能保存草稿或停用绑定。',
    },
    {
      key: 'wecom',
      label: '企业微信',
      syncAvailable: false,
      unavailableReason: '企业微信通讯录连接器尚未接入组织来源同步。',
    },
    {
      key: 'dingtalk',
      label: '钉钉',
      syncAvailable: false,
      unavailableReason: '钉钉通讯录连接器尚未接入组织来源同步。',
    },
  ]
}

export function sortActiveOrganizationSources(sources: OrganizationSource[]): OrganizationSource[] {
  return sources
    .filter((source) => source.status === 'active')
    .sort((left, right) => left.priority - right.priority || left.id.localeCompare(right.id))
}

export function selectPrimaryOrganizationSource(
  sources: OrganizationSource[],
): OrganizationSource {
  const primary = sortActiveOrganizationSources(sources).filter((source) => source.priority === 1)
  if (primary.length === 0) {
    throw new OrganizationSourceError(
      'SOURCE_REQUIRED',
      '当前组织没有已启用的主组织来源。',
    )
  }
  if (primary.length > 1) {
    throw new OrganizationSourceError(
      'SOURCE_AMBIGUOUS',
      '当前组织存在多个主组织来源。',
    )
  }
  return primary[0]
}

export async function loadOrganizationSources(orgId: string): Promise<OrganizationSource[]> {
  const { data, error } = await supabaseAdmin
    .from('organization_sources')
    .select('id, system_org_id, provider, external_tenant_id, priority, status, authority_scope, sync_mode, last_successful_sync_at, last_error, created_at, updated_at')
    .eq('system_org_id', orgId)
    .order('priority', { ascending: true })

  if (error) {
    throw new OrganizationSourceError(
      'SOURCE_INVALID',
      '组织来源暂时不可用。',
      503,
    )
  }

  return (data || [])
    .map((value) => normalizeSource(value))
    .filter((source): source is OrganizationSource => Boolean(source))
}

export function validateOrganizationSourceBinding(input: {
  provider: string
  externalTenantId: string
  priority: number
  status: OrganizationSourceStatus
  syncMode: OrganizationSource['syncMode']
  providers?: OrganizationSourceProvider[]
}) {
  const providers = input.providers || listOrganizationSourceProviders()
  const provider = providers.find((item) => item.key === input.provider)
  if (!provider) throw new OrganizationSourceError('SOURCE_INVALID', '不支持的组织来源提供方。', 400)
  if (!input.externalTenantId.trim() || input.externalTenantId.trim().length > 255) {
    throw new OrganizationSourceError('SOURCE_INVALID', '外部组织租户标识不能为空且不能超过255个字符。', 400)
  }
  if (!Number.isInteger(input.priority) || input.priority < 1 || input.priority > 100) {
    throw new OrganizationSourceError('SOURCE_INVALID', '组织来源优先级必须是1-100的整数。', 400)
  }
  if (input.status === 'active' && !provider.syncAvailable) {
    throw new OrganizationSourceError('SOURCE_INVALID', provider.unavailableReason || '该组织来源连接器尚未接入。', 409)
  }
  if (input.status === 'active' && input.priority === 1 && input.syncMode !== 'authoritative') {
    throw new OrganizationSourceError('SOURCE_INVALID', '来源1必须是权威组织来源。', 400)
  }
  if (input.status === 'active' && input.priority > 1 && input.syncMode === 'authoritative') {
    throw new OrganizationSourceError('SOURCE_INVALID', '只有来源1可以成为权威组织来源。', 400)
  }
}

export async function bindOrganizationSource(input: {
  systemOrgId: string
  provider: string
  externalTenantId: string
  priority: number
  status: OrganizationSourceStatus
  syncMode: OrganizationSource['syncMode']
  authorityScope?: Record<string, unknown>
  actorId: string
  providers?: OrganizationSourceProvider[]
}): Promise<OrganizationSource> {
  validateOrganizationSourceBinding(input)
  const authorityScope = input.authorityScope && Object.keys(input.authorityScope).length
    ? input.authorityScope
    : input.priority === 1 && input.status === 'active'
      ? {
          departments: 'authoritative',
          department_order: 'authoritative',
          primary_department: 'authoritative',
          employment_state: 'authoritative',
          identity: 'evidence',
        }
      : { identity: 'evidence' }
  const { data, error } = await supabaseAdmin.rpc('bind_organization_source', {
    p_system_org_id: input.systemOrgId,
    p_provider: input.provider,
    p_external_tenant_id: input.externalTenantId.trim(),
    p_priority: input.priority,
    p_status: input.status,
    p_sync_mode: input.syncMode,
    p_authority_scope: authorityScope,
    p_actor_id: input.actorId,
  })
  if (error) throw new OrganizationSourceError('SOURCE_INVALID', '组织来源绑定保存失败。', 409)
  const row = Array.isArray(data) ? data[0] : data
  const source = normalizeSource(row)
  if (!source) throw new OrganizationSourceError('SOURCE_INVALID', '组织来源返回结构无效。', 503)
  return source
}

export async function unbindOrganizationSource(input: {
  systemOrgId: string
  sourceId: string
  actorId: string
}): Promise<OrganizationSource> {
  const { data, error } = await supabaseAdmin.rpc('unbind_organization_source', {
    p_system_org_id: input.systemOrgId,
    p_source_id: input.sourceId,
    p_actor_id: input.actorId,
  })
  if (error) throw new OrganizationSourceError('SOURCE_INVALID', '组织来源解绑失败。', 409)
  const row = Array.isArray(data) ? data[0] : data
  const source = normalizeSource(row)
  if (!source) throw new OrganizationSourceError('SOURCE_INVALID', '组织来源不存在或不属于当前组织。', 404)
  return source
}

export async function recordOrganizationSourceSyncResult(input: {
  systemOrgId: string
  sourceId: string
  error: string | null
}): Promise<void> {
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('organization_sources')
    .update({
      last_successful_sync_at: input.error ? undefined : now,
      last_error: input.error,
      updated_at: now,
    })
    .eq('id', input.sourceId)
    .eq('system_org_id', input.systemOrgId)

  if (error) {
    console.error('organization source sync status update failed', error.message)
  }
}

export async function ensureOrganizationSource(input: {
  systemOrgId: string
  provider: string
  externalTenantId: string
  priority: number
  status?: OrganizationSourceStatus
  authorityScope?: Record<string, unknown>
  syncMode?: OrganizationSource['syncMode']
  actorId?: string | null
}): Promise<OrganizationSource> {
  if (
    !input.systemOrgId
    || !input.provider.trim()
    || !input.externalTenantId.trim()
    || !Number.isInteger(input.priority)
    || input.priority < 1
    || input.priority > 100
  ) {
    throw new OrganizationSourceError('SOURCE_INVALID', '组织来源参数不正确。', 400)
  }

  const now = new Date().toISOString()
  const { data, error } = await supabaseAdmin
    .from('organization_sources')
    .upsert({
      system_org_id: input.systemOrgId,
      provider: input.provider.trim(),
      external_tenant_id: input.externalTenantId.trim(),
      priority: input.priority,
      status: input.status || 'active',
      authority_scope: input.authorityScope || {},
      sync_mode: input.syncMode || 'read_only',
      updated_by: input.actorId || null,
      updated_at: now,
    }, {
      onConflict: 'system_org_id,provider,external_tenant_id',
    })
    .select('id, system_org_id, provider, external_tenant_id, priority, status, authority_scope, sync_mode')
    .single()

  if (error || !data) {
    throw new OrganizationSourceError(
      'SOURCE_INVALID',
      '组织来源保存失败。',
      409,
    )
  }

  const source = normalizeSource(data)
  if (!source) {
    throw new OrganizationSourceError(
      'SOURCE_INVALID',
      '组织来源返回结构无效。',
      503,
    )
  }
  return source
}

export async function upsertExternalIdentity(input: {
  sourceId: string
  systemOrgId: string
  externalUserId: string
  externalUnionId?: string | null
  externalOpenId?: string | null
  canonicalUserId?: string | null
  matchStatus?: 'unresolved' | 'matched' | 'conflict' | 'ignored'
  matchMethod?: 'none' | 'provider_id' | 'employee_id' | 'email' | 'phone' | 'manual'
  matchConfidence?: number
  profileSnapshot?: Record<string, unknown>
  observedAt?: string
}): Promise<void> {
  if (
    !input.sourceId
    || !input.systemOrgId
    || !input.externalUserId.trim()
  ) {
    throw new OrganizationSourceError('SOURCE_INVALID', '外部身份参数不正确。', 400)
  }

  const confidence = input.matchConfidence ?? (
    input.matchStatus === 'matched' ? 1 : 0
  )
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new OrganizationSourceError('SOURCE_INVALID', '外部身份匹配置信度不正确。', 400)
  }

  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('external_identities')
    .upsert({
      source_id: input.sourceId,
      system_org_id: input.systemOrgId,
      external_user_id: input.externalUserId.trim(),
      external_union_id: input.externalUnionId || null,
      external_open_id: input.externalOpenId || null,
      canonical_user_id: input.canonicalUserId || null,
      match_status: input.matchStatus || 'unresolved',
      match_method: input.matchMethod || 'none',
      match_confidence: confidence,
      profile_snapshot: input.profileSnapshot || {},
      observed_at: input.observedAt || now,
      updated_at: now,
    }, {
      onConflict: 'source_id,external_user_id',
    })

  if (error) {
    throw new OrganizationSourceError(
      'SOURCE_INVALID',
      '外部身份保存失败。',
      503,
    )
  }
}

