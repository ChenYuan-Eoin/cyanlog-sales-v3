import { supabaseAdmin } from '@/lib/supabase'
import { getShippingPermissionPublication, REGISTERED_MODULE_PERMISSION_KEYS } from '@/lib/module-access'
import { loadOrgRolePermissionContext } from '@/lib/org-role-permissions'
import {
  BUILTIN_PERMISSION_DEFINITIONS,
  buildPermissionCatalog,
  permissionDefinitionIsValid,
  type PermissionCatalogGroup,
  type PermissionDefinition,
  type PermissionKind,
  type PermissionLifecycleStatus,
  type PermissionScopeType,
} from '@/lib/permission-catalog'

const PERMISSION_COLUMNS = [
  'id',
  'code',
  'name',
  'description',
  'resource',
  'action',
  'kind',
  'status',
  'category',
  'semantic_version',
  'lifecycle_version',
  'supported_scope_types',
  'dependencies',
  'conflicts',
  'implied_by',
  'enforcement_consumer',
  'published_at',
  'deprecated_at',
  'disabled_at',
  'deleted_at',
].join(',')

type PermissionRow = {
  id: string
  code: string
  name: string
  description: string | null
  resource?: string | null
  action?: string | null
  kind?: PermissionKind | null
  status?: PermissionLifecycleStatus | null
  category?: string | null
  semantic_version?: string | null
  lifecycle_version?: number | null
  supported_scope_types?: PermissionScopeType[] | null
  dependencies?: string[] | null
  conflicts?: string[] | null
  implied_by?: string[] | null
  enforcement_consumer?: string | null
  published_at?: string | null
  deprecated_at?: string | null
  disabled_at?: string | null
  deleted_at?: string | null
}

export type PermissionDefinitionInput = {
  key?: unknown
  label?: unknown
  description?: unknown
  category?: unknown
  kind?: unknown
  scopeTypes?: unknown
  dependencies?: unknown
  conflicts?: unknown
  enforcementConsumer?: unknown
}

export class PermissionRegistryError extends Error {
  constructor(
    public readonly code: 'NOT_FOUND' | 'INVALID' | 'CONFLICT' | 'FORBIDDEN',
    message: string,
  ) {
    super(message)
    this.name = 'PermissionRegistryError'
  }
}

function fromRow(row: PermissionRow): PermissionDefinition {
  const [resource, action = '*'] = row.code.split(':')
  return {
    id: row.id,
    key: row.code,
    version: row.lifecycle_version ?? 1,
    semanticVersion: row.semantic_version ?? '1.0.0',
    resource: row.resource ?? resource,
    action: row.action ?? action,
    kind: row.kind ?? (row.code.endsWith(':*') ? 'bundle' : 'atomic'),
    status: row.status ?? 'published',
    category: row.category ?? 'console',
    label: row.name,
    description: row.description ?? '',
    scopeTypes: row.supported_scope_types ?? ['org', 'department', 'space', 'self'],
    dependencies: row.dependencies ?? [],
    conflicts: row.conflicts ?? [],
    enforcementConsumer: row.enforcement_consumer ?? null,
    impliedBy: row.implied_by ?? [],
    publishedAt: row.published_at ?? null,
    deprecatedAt: row.deprecated_at ?? null,
    disabledAt: row.disabled_at ?? null,
    deletedAt: row.deleted_at ?? null,
  }
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)))
    : []
}

function scopeList(value: unknown): PermissionScopeType[] {
  const allowed = new Set<PermissionScopeType>(['org', 'department', 'space', 'self'])
  const scopes = stringList(value).filter((item): item is PermissionScopeType => allowed.has(item as PermissionScopeType))
  return scopes.length > 0 ? scopes : ['org', 'department', 'space', 'self']
}

function inputDefinition(
  input: PermissionDefinitionInput,
  current?: PermissionDefinition,
): PermissionDefinition {
  const key = typeof input.key === 'string' ? input.key.trim() : current?.key
  const label = typeof input.label === 'string' ? input.label.trim() : current?.label
  const description = typeof input.description === 'string' ? input.description.trim() : current?.description
  const category = typeof input.category === 'string' ? input.category.trim() : current?.category
  const kind = input.kind === 'atomic' || input.kind === 'bundle'
    ? input.kind
    : current?.kind ?? (key?.endsWith(':*') ? 'bundle' : 'atomic')
  const enforcementConsumer = typeof input.enforcementConsumer === 'string'
    ? input.enforcementConsumer.trim()
    : input.enforcementConsumer === null
      ? null
      : current?.enforcementConsumer ?? null
  const [resource, action = '*'] = (key ?? '').split(':')
  return {
    id: current?.id ?? '',
    key: key ?? '',
    version: current?.version ?? 1,
    semanticVersion: current?.semanticVersion ?? '1.0.0',
    resource,
    action,
    kind,
    status: current?.status ?? 'draft',
    category: category ?? '',
    label: label ?? '',
    description: description ?? '',
    scopeTypes: input.scopeTypes === undefined ? current?.scopeTypes ?? ['org', 'department', 'space', 'self'] : scopeList(input.scopeTypes),
    dependencies: input.dependencies === undefined ? current?.dependencies ?? [] : stringList(input.dependencies),
    conflicts: input.conflicts === undefined ? current?.conflicts ?? [] : stringList(input.conflicts),
    enforcementConsumer,
    impliedBy: current?.impliedBy ?? [],
    publishedAt: current?.publishedAt ?? null,
    deprecatedAt: current?.deprecatedAt ?? null,
    disabledAt: current?.disabledAt ?? null,
    deletedAt: current?.deletedAt ?? null,
  }
}

function toRow(definition: PermissionDefinition) {
  return {
    code: definition.key,
    name: definition.label,
    description: definition.description,
    resource: definition.resource,
    action: definition.action,
    kind: definition.kind,
    status: definition.status,
    category: definition.category,
    semantic_version: definition.semanticVersion,
    lifecycle_version: definition.version,
    supported_scope_types: definition.scopeTypes,
    dependencies: definition.dependencies,
    conflicts: definition.conflicts,
    implied_by: definition.impliedBy,
    enforcement_consumer: definition.enforcementConsumer,
    published_at: definition.publishedAt,
    deprecated_at: definition.deprecatedAt,
    disabled_at: definition.disabledAt,
    deleted_at: definition.deletedAt,
  }
}

function snapshot(definition: PermissionDefinition) {
  return {
    key: definition.key,
    label: definition.label,
    description: definition.description,
    resource: definition.resource,
    action: definition.action,
    kind: definition.kind,
    category: definition.category,
    semanticVersion: definition.semanticVersion,
    scopeTypes: definition.scopeTypes,
    dependencies: definition.dependencies,
    conflicts: definition.conflicts,
    enforcementConsumer: definition.enforcementConsumer,
  }
}

async function recordAudit(input: {
  actorId: string
  permissionId: string
  action: string
  before?: PermissionDefinition | null
  after?: PermissionDefinition | null
  reason?: string | null
}) {
  const { error } = await supabaseAdmin.from('permission_point_audit_logs').insert({
    permission_point_id: input.permissionId,
    actor_id: input.actorId,
    action: input.action,
    before_snapshot: input.before ? snapshot(input.before) : null,
    after_snapshot: input.after ? snapshot(input.after) : null,
    reason: input.reason ?? null,
  })
  if (error) throw error
}

async function recordVersion(definition: PermissionDefinition, actorId: string) {
  const { error } = await supabaseAdmin.from('permission_point_versions').upsert({
    permission_point_id: definition.id,
    semantic_version: definition.semanticVersion,
    lifecycle_version: definition.version,
    snapshot: snapshot(definition),
    status: definition.status,
    created_by: actorId,
    published_at: definition.status === 'published' ? new Date().toISOString() : null,
  }, { onConflict: 'permission_point_id,lifecycle_version' })
  if (error) throw error
}

export async function listPermissionDefinitions(options: {
  includeUnpublished?: boolean
  allowFallback?: boolean
} = {}): Promise<{ definitions: PermissionDefinition[]; source: 'database' | 'builtin' }> {
  let query = supabaseAdmin.from('permission_points').select(PERMISSION_COLUMNS)
  if (!options.includeUnpublished) query = query.eq('status', 'published')
  const { data, error } = await query.order('category').order('code')
  if (!error && Array.isArray(data) && data.length > 0) {
    return { definitions: (data as unknown as PermissionRow[]).map(fromRow), source: 'database' }
  }
  if (options.allowFallback === false || options.includeUnpublished) {
    throw error || new PermissionRegistryError('NOT_FOUND', '权限注册表没有可用定义。')
  }
  return {
    definitions: BUILTIN_PERMISSION_DEFINITIONS.filter((item) => options.includeUnpublished || item.status === 'published'),
    source: 'builtin',
  }
}

export async function loadPublishedPermissionCatalog(): Promise<{
  catalog: PermissionCatalogGroup[]
  definitions: PermissionDefinition[]
  source: 'database' | 'builtin'
}> {
  let result: { definitions: PermissionDefinition[]; source: 'database' | 'builtin' }
  try {
    result = await listPermissionDefinitions({ includeUnpublished: true, allowFallback: false })
  } catch {
    result = { definitions: BUILTIN_PERMISSION_DEFINITIONS, source: 'builtin' }
  }
  return {
    catalog: buildPermissionCatalog(result.definitions, { includeUnavailable: true }),
    definitions: result.definitions,
    source: result.source,
  }
}

async function readLiveModulePermissionRows(): Promise<PermissionRow[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('permission_points')
      .select(PERMISSION_COLUMNS)
      .in('code', [...REGISTERED_MODULE_PERMISSION_KEYS])

    if (error || !Array.isArray(data)) return []
    return data as unknown as PermissionRow[]
  } catch {
    return []
  }
}

export async function loadShippingModulePermissionState() {
  return getShippingPermissionPublication(await readLiveModulePermissionRows())
}

export async function loadPublishedModulePermissionKeys(): Promise<string[]> {
  const { published } = await loadShippingModulePermissionState()
  return [...published].sort()
}

export async function loadRoleModulePermissionCatalog(): Promise<PermissionCatalogGroup[]> {
  const rows = await readLiveModulePermissionRows()
  const { published } = getShippingPermissionPublication(rows)
  return buildPermissionCatalog(rows.filter(row => row && published.has(row.code)).map(fromRow))
}

export async function loadPermissionDefinition(id: string): Promise<PermissionDefinition> {
  const { data, error } = await supabaseAdmin.from('permission_points')
    .select(PERMISSION_COLUMNS)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new PermissionRegistryError('NOT_FOUND', '权限定义不存在。')
  return fromRow(data as unknown as PermissionRow)
}

export async function createPermissionDefinition(
  actorId: string,
  input: PermissionDefinitionInput,
): Promise<PermissionDefinition> {
  const definition = inputDefinition(input)
  definition.status = 'draft'
  const existing = await listPermissionDefinitions({ includeUnpublished: true, allowFallback: false })
  const errors = permissionDefinitionIsValid(definition, existing.definitions)
  if (errors.length) throw new PermissionRegistryError('INVALID', errors.join(' '))
  const { data, error } = await supabaseAdmin.from('permission_points')
    .insert({ ...toRow(definition), created_by: actorId, updated_by: actorId })
    .select(PERMISSION_COLUMNS)
    .single()
  if (error) {
    if (String(error.code || '') === '23505') throw new PermissionRegistryError('CONFLICT', '权限 key 已存在。')
    throw error
  }
  const created = fromRow(data as unknown as PermissionRow)
  await recordAudit({ actorId, permissionId: created.id, action: 'create', after: created })
  return created
}

export async function updatePermissionDefinition(
  actorId: string,
  id: string,
  input: PermissionDefinitionInput,
): Promise<PermissionDefinition> {
  const current = await loadPermissionDefinition(id)
  if (!['draft', 'reviewed', 'disabled'].includes(current.status)) {
    throw new PermissionRegistryError('CONFLICT', '只有草稿、待发布或已停用定义可以原地修改；已发布定义必须先修订版本。')
  }
  const next = inputDefinition(input, current)
  const all = await listPermissionDefinitions({ includeUnpublished: true, allowFallback: false })
  const errors = permissionDefinitionIsValid(next, all.definitions)
  if (errors.length) throw new PermissionRegistryError('INVALID', errors.join(' '))
  const { data, error } = await supabaseAdmin.from('permission_points')
    .update({ ...toRow(next), updated_by: actorId })
    .eq('id', id)
    .eq('lifecycle_version', current.version)
    .select(PERMISSION_COLUMNS)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new PermissionRegistryError('CONFLICT', '权限定义已被其他管理员更新。')
  const updated = fromRow(data as unknown as PermissionRow)
  await recordAudit({ actorId, permissionId: id, action: 'update', before: current, after: updated })
  return updated
}

export async function transitionPermissionDefinition(
  actorId: string,
  id: string,
  action: 'review' | 'publish' | 'deprecate' | 'disable',
  reason?: string,
): Promise<PermissionDefinition> {
  const current = await loadPermissionDefinition(id)
  const allowed: Record<'review' | 'publish' | 'deprecate' | 'disable', PermissionLifecycleStatus[]> = {
    review: ['draft'],
    publish: ['reviewed'],
    deprecate: ['published'],
    disable: ['published', 'deprecated'],
  }
  if (!allowed[action].includes(current.status)) {
    throw new PermissionRegistryError('CONFLICT', `权限状态 ${current.status} 不能执行 ${action}。`)
  }
  if (action === 'publish') {
    const all = await listPermissionDefinitions({ includeUnpublished: true, allowFallback: false })
    const errors = permissionDefinitionIsValid(current, all.definitions)
    if (!current.enforcementConsumer) errors.push('发布前必须登记真实执行消费者。')
    if (errors.length) throw new PermissionRegistryError('INVALID', errors.join(' '))
  }
  const statusByAction: Record<'review' | 'publish' | 'deprecate' | 'disable', PermissionLifecycleStatus> = {
    review: 'reviewed',
    publish: 'published',
    deprecate: 'deprecated',
    disable: 'disabled',
  }
  const nextStatus = statusByAction[action]
  const nextVersion = current.version + 1
  const now = new Date().toISOString()
  const patch: Record<string, unknown> = {
    status: nextStatus,
    lifecycle_version: nextVersion,
    updated_by: actorId,
    updated_at: now,
  }
  if (nextStatus === 'published') patch.published_at = now
  if (nextStatus === 'deprecated') patch.deprecated_at = now
  if (nextStatus === 'disabled') patch.disabled_at = now
  const { data, error } = await supabaseAdmin.from('permission_points')
    .update(patch)
    .eq('id', id)
    .eq('lifecycle_version', current.version)
    .select(PERMISSION_COLUMNS)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new PermissionRegistryError('CONFLICT', '权限定义已被其他管理员更新。')
  const next = { ...fromRow(data as unknown as PermissionRow), version: nextVersion }
  await recordVersion(next, actorId)
  await recordAudit({
    actorId,
    permissionId: id,
    action,
    before: current,
    after: next,
    reason: reason ?? null,
  })
  return next
}

export async function softDeletePermissionDefinition(
  actorId: string,
  id: string,
  reason?: string,
): Promise<PermissionDefinition> {
  const current = await loadPermissionDefinition(id)
  if (current.status === 'deleted') return current
  if (current.status === 'published') {
    throw new PermissionRegistryError('CONFLICT', '已发布权限必须先停用，才能软删除。')
  }
  const now = new Date().toISOString()
  const nextVersion = current.version + 1
  const { data, error } = await supabaseAdmin.from('permission_points')
    .update({
      status: 'deleted',
      lifecycle_version: nextVersion,
      deleted_at: now,
      updated_by: actorId,
      updated_at: now,
    })
    .eq('id', id)
    .eq('lifecycle_version', current.version)
    .select(PERMISSION_COLUMNS)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new PermissionRegistryError('CONFLICT', '权限定义已被其他管理员更新。')
  const deleted = { ...fromRow(data as unknown as PermissionRow), version: nextVersion }
  await recordVersion(deleted, actorId)
  await recordAudit({ actorId, permissionId: id, action: 'delete', before: current, after: deleted, reason })
  return deleted
}

export async function restorePermissionDefinition(
  actorId: string,
  id: string,
): Promise<PermissionDefinition> {
  const current = await loadPermissionDefinition(id)
  if (current.status !== 'deleted') {
    throw new PermissionRegistryError('CONFLICT', '只有已软删除的权限可以恢复。')
  }
  const nextVersion = current.version + 1
  const next: PermissionDefinition = {
    ...current,
    version: nextVersion,
    semanticVersion: `${Number.parseInt(current.semanticVersion.split('.')[0], 10) + 1}.0.0`,
    status: 'draft',
    publishedAt: null,
    deprecatedAt: null,
    disabledAt: null,
    deletedAt: null,
  }
  const { data, error } = await supabaseAdmin.from('permission_points')
    .update({ ...toRow(next), updated_by: actorId, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('lifecycle_version', current.version)
    .select(PERMISSION_COLUMNS)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new PermissionRegistryError('CONFLICT', '权限定义已被其他管理员更新。')
  const restored = fromRow(data as unknown as PermissionRow)
  await recordVersion(restored, actorId)
  await recordAudit({ actorId, permissionId: id, action: 'restore', before: current, after: restored })
  return restored
}

export async function canManagePlatformPermissionRegistry(userId: string, orgId: string): Promise<boolean> {
  const configuredOrgId = process.env.PERMISSION_REGISTRY_ADMIN_ORG_ID
  if (!configuredOrgId || configuredOrgId !== orgId) return false
  const context = await loadOrgRolePermissionContext(userId)
  return context?.orgId === orgId && context.canEditPlatformRoot
}

export function permissionRegistryErrorResponse(error: unknown) {
  if (error instanceof PermissionRegistryError) {
    return {
      code: error.code,
      message: error.message,
    }
  }
  return null
}
