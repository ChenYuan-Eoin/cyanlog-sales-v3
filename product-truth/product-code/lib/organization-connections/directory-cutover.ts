// REQ: F003 / WP92. Immutable directory diff, explicit primary-source cutover and rollback.
import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import {
  buildIdentityIndex,
  resolveIdentityMatch,
  type IdentityCandidate,
} from '@/lib/organization-source-identity'
import { getConnectionAdapter, getDirectoryAdapter, isConfigurableProvider } from './adapters'
import { OrganizationConnectionError } from './errors'
import { loadOrganizationConnection, readOrganizationDirectory } from './service'
import { assertDirectoryCutoverStorage } from './storage'
import type { OrganizationConnectionProvider, DirectoryPreview } from './types'

export const DIRECTORY_CUTOVER_CONTRACT = 'f003-directory-cutover-v2'
const PLAN_LIFETIME_MS = 30 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type SourceStatus = 'draft' | 'active' | 'disabled'
type SyncMode = 'read_only' | 'authoritative' | 'enrichment'

export type DirectorySourceRow = {
  id: string
  systemOrgId: string
  provider: string
  externalTenantId: string
  priority: number
  status: SourceStatus
  authorityScope: Record<string, unknown>
  syncMode: SyncMode
  configurationRevision: string
  connectionState: 'unconfigured' | 'configured' | 'verified' | 'failed' | 'disabled'
  effectiveRevision: string | null
  draftCheckStatus: 'not_checked' | 'preview_ready' | 'failed'
  lastSuccessfulSyncAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  updatedAt: string
}
export type DirectoryDepartmentRow = {
  id: string
  orgId: string
  parentId: string | null
  name: string
  code: string | null
  path: string | null
  depth: number
  externalId: string | null
  source: string
  status: string
  sortOrder: number
  memberCount: number
  updatedAt: string
}

export type DirectoryUserRow = IdentityCandidate & {
  id: string
  orgId: string
  status: string | null
  primaryDepartmentId: string | null
  loginEnabled: boolean
  updatedAt: string
}

export type DirectoryIdentityRow = {
  id: string
  sourceId: string
  systemOrgId: string
  externalUserId: string
  externalUnionId: string | null
  externalOpenId: string | null
  canonicalUserId: string | null
  matchStatus: 'unresolved' | 'matched' | 'conflict' | 'ignored'
  matchMethod: 'none' | 'provider_id' | 'employee_id' | 'email' | 'phone' | 'manual'
  matchConfidence: number
  profileSnapshot: Record<string, unknown>
  observedAt: string
  updatedAt: string
}

export type DirectoryMembershipRow = {
  userId: string
  departmentId: string
  orgId: string
  isPrimary: boolean
  source: string
  joinedAt: string
}

export type DirectoryOrganizationMembership = {
  userId: string
  orgId: string
  primaryDepartmentId: string | null
  status: string
  employmentStatus: string
  isDefault: boolean
  createdAt: string
}

export type DirectoryCutoverConflict = {
  kind: string
  externalId: string | null
  message: string
  candidateUserIds?: string[]
}

export type DirectoryCutoverDepartmentChange = {
  kind: 'added' | 'updated' | 'unchanged'
  externalId: string
  existingDepartmentId: string | null
  name: string
  parentExternalId: string | null
  status: 'active' | 'inactive'
  changedFields: string[]
}

export type DirectoryCutoverIdentityChange = {
  kind: 'added' | 'updated' | 'unchanged'
  externalUserId: string
  existingIdentityId: string | null
  canonicalUserId: string
  createsMember: boolean
  displayName: string
  matchMethod: 'none' | 'provider_id' | 'employee_id' | 'email' | 'phone' | 'manual'
  confidence: number
  departmentExternalIds: string[]
  active: boolean
  profileSnapshot: Record<string, unknown>
  changedFields: string[]
}

export type DirectoryCutoverUserDepartmentChange = {
  userId: string
  externalUserId: string
  departmentExternalIds: string[]
  primaryDepartmentExternalId: string | null
  active: boolean
}

export type DirectoryCutoverPlanPayload = {
  version: typeof DIRECTORY_CUTOVER_CONTRACT
  organizationId: string
  targetProvider: OrganizationConnectionProvider
  targetSourceId: string
  targetExternalTenantId: string
  connectionRevision: string
  previousPrimarySourceId: string | null
  sourceRevisions: Array<{
    id: string
    provider: string
    priority: number
    status: SourceStatus
    syncMode: SyncMode
    configurationRevision: string
    updatedAt: string
  }>
  snapshot: {
    checkedAt: string
    complete: boolean
    connectionVerified: boolean
    scopeVerified: boolean
    scopeEvidence: string | null
    directoryHash: string
    departmentCount: number
    employeeCount: number
    warnings: string[]
  }
  summary: {
    departmentsAdded: number
    departmentsUpdated: number
    departmentsUnchanged: number
    departmentsToDeactivate: number
    identitiesAdded: number
    identitiesUpdated: number
    identitiesUnchanged: number
    conflicts: number
  }
  conflicts: DirectoryCutoverConflict[]
  notices: string[]
  departmentChanges: DirectoryCutoverDepartmentChange[]
  staleTargetDepartmentIds: string[]
  identityChanges: DirectoryCutoverIdentityChange[]
  userDepartmentChanges: DirectoryCutoverUserDepartmentChange[]
  preserved: {
    manualDepartmentCount: number
    otherSourceDepartmentCount: number
    otherSourceIdentityCount: number
    previousPrimaryDepartmentsRetained: number
    previousPrimaryIdentitiesRetained: number
  }
  beforeState: DirectoryStateSnapshot
  applyable: boolean
  planHash: string
}

export type DirectoryStateSnapshot = {
  sources: DirectorySourceRow[]
  targetDepartments: DirectoryDepartmentRow[]
  targetIdentities: DirectoryIdentityRow[]
  users: Array<{
    id: string
    primaryDepartmentId: string | null
    status: string | null
    loginEnabled: boolean
    updatedAt: string
  }>
  memberships: DirectoryMembershipRow[]
  organizationMemberships: DirectoryOrganizationMembership[]
}

export type DirectoryCutoverInput = {
  organizationId: string
  targetSourceId: string
  connectionRevision: string
  snapshot: DirectoryPreview
  /** Only set after current server-side connection verification and a bound directory read. */
  connectionVerified: boolean
  sources: DirectorySourceRow[]
  departments: DirectoryDepartmentRow[]
  users: DirectoryUserRow[]
  identities: DirectoryIdentityRow[]
  memberships: DirectoryMembershipRow[]
  organizationMemberships: DirectoryOrganizationMembership[]
}

export type DirectoryCutoverClientPlan = {
  id: string
  planHash: string
  contractVersion: typeof DIRECTORY_CUTOVER_CONTRACT
  provider: OrganizationConnectionProvider
  targetSourceId: string
  targetExternalTenantId: string
  connectionRevision: string
  previousPrimarySourceId: string | null
  sourceRevisions: DirectoryCutoverPlanPayload['sourceRevisions']
  createdAt: string
  expiresAt: string
  status: 'planned' | 'applied' | 'superseded' | 'rolled_back'
  applyable: boolean
  snapshot: DirectoryCutoverPlanPayload['snapshot']
  summary: DirectoryCutoverPlanPayload['summary']
  conflicts: DirectoryCutoverConflict[]
  notices: string[]
  departmentChanges: DirectoryCutoverDepartmentChange[]
  identityChanges: Array<Omit<DirectoryCutoverIdentityChange, 'profileSnapshot'>>
  preserved: DirectoryCutoverPlanPayload['preserved']
  appliedAt?: string | null
  rolledBackAt?: string | null
  run?: DirectoryCutoverRunResult | null
}

export type DirectoryCutoverRunResult = {
  runId: string
  planId: string
  status: 'applied' | 'rolled_back'
  appliedAt: string
  rolledBackAt: string | null
  sourceId: string
  previousPrimarySourceId: string | null
  departments: number
  identities: number
  members: number
}

type CurrentState = Omit<DirectoryCutoverInput, 'connectionRevision' | 'targetSourceId' | 'snapshot' | 'connectionVerified'>

function storageFailure() {
  return new OrganizationConnectionError(
    'DIRECTORY_STORAGE_UNAVAILABLE',
    '组织目录存储暂时不可用，请稍后重试。',
    503,
  )
}

function stringValue(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new OrganizationConnectionError('DIRECTORY_STATE_INVALID', `${field} 缺失，不能生成切源计划。`, 503)
  }
  return value.trim()
}

function optionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function integerValue(value: unknown, fallback = 0) {
  return typeof value === 'number' && Number.isInteger(value) ? value : fallback
}

function objectValue(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function booleanValue(value: unknown, fallback = false) {
  return typeof value === 'boolean' ? value : fallback
}

function sourceRow(value: unknown): DirectorySourceRow {
  const row = objectValue(value)
  return {
    id: stringValue(row.id, 'organization_sources.id'),
    systemOrgId: stringValue(row.system_org_id, 'organization_sources.system_org_id'),
    provider: stringValue(row.provider, 'organization_sources.provider'),
    externalTenantId: stringValue(row.external_tenant_id, 'organization_sources.external_tenant_id'),
    priority: integerValue(row.priority),
    status: ['draft', 'active', 'disabled'].includes(String(row.status)) ? row.status as SourceStatus : 'disabled',
    authorityScope: objectValue(row.authority_scope),
    syncMode: ['read_only', 'authoritative', 'enrichment'].includes(String(row.sync_mode)) ? row.sync_mode as SyncMode : 'read_only',
    configurationRevision: stringValue(row.configuration_revision, 'organization_sources.configuration_revision'),
    connectionState: ['unconfigured', 'configured', 'verified', 'failed', 'disabled'].includes(String(row.connection_state)) ? row.connection_state as DirectorySourceRow['connectionState'] : 'unconfigured',
    effectiveRevision: optionalString(row.effective_revision),
    draftCheckStatus: ['not_checked', 'preview_ready', 'failed'].includes(String(row.draft_check_status)) ? row.draft_check_status as DirectorySourceRow['draftCheckStatus'] : 'not_checked',
    lastSuccessfulSyncAt: optionalString(row.last_successful_sync_at),
    lastError: optionalString(row.last_error),
    lastErrorAt: optionalString(row.last_error_at),
    updatedAt: stringValue(row.updated_at, 'organization_sources.updated_at'),
  }
}

function departmentRow(value: unknown): DirectoryDepartmentRow {
  const row = objectValue(value)
  return {
    id: stringValue(row.id, 'departments.id'),
    orgId: stringValue(row.org_id, 'departments.org_id'),
    parentId: optionalString(row.parent_id),
    name: stringValue(row.name, 'departments.name'),
    code: optionalString(row.code),
    path: optionalString(row.path),
    depth: integerValue(row.depth),
    externalId: optionalString(row.external_id),
    source: stringValue(row.source, 'departments.source'),
    status: optionalString(row.status) || 'active',
    sortOrder: integerValue(row.sort_order),
    memberCount: integerValue(row.member_count),
    updatedAt: stringValue(row.updated_at, 'departments.updated_at'),
  }
}

function userRow(value: unknown): DirectoryUserRow {
  const row = objectValue(value)
  return {
    id: stringValue(row.id, 'users.id'),
    orgId: stringValue(row.org_id, 'users.org_id'),
    email: optionalString(row.email),
    phone: optionalString(row.phone),
    employeeId: optionalString(row.employee_id),
    displayName: optionalString(row.display_name),
    title: optionalString(row.title),
    avatarUrl: optionalString(row.avatar_url),
    status: optionalString(row.status),
    primaryDepartmentId: optionalString(row.primary_dept_id),
    loginEnabled: row.login_enabled === true,
    updatedAt: stringValue(row.updated_at, 'users.updated_at'),
  }
}

function identityRow(value: unknown): DirectoryIdentityRow {
  const row = objectValue(value)
  return {
    id: stringValue(row.id, 'external_identities.id'),
    sourceId: stringValue(row.source_id, 'external_identities.source_id'),
    systemOrgId: stringValue(row.system_org_id, 'external_identities.system_org_id'),
    externalUserId: stringValue(row.external_user_id, 'external_identities.external_user_id'),
    externalUnionId: optionalString(row.external_union_id),
    externalOpenId: optionalString(row.external_open_id),
    canonicalUserId: optionalString(row.canonical_user_id),
    matchStatus: ['unresolved', 'matched', 'conflict', 'ignored'].includes(String(row.match_status)) ? row.match_status as DirectoryIdentityRow['matchStatus'] : 'unresolved',
    matchMethod: ['none', 'provider_id', 'employee_id', 'email', 'phone', 'manual'].includes(String(row.match_method)) ? row.match_method as DirectoryIdentityRow['matchMethod'] : 'none',
    matchConfidence: typeof row.match_confidence === 'number' ? row.match_confidence : Number(row.match_confidence || 0),
    profileSnapshot: objectValue(row.profile_snapshot),
    observedAt: stringValue(row.observed_at, 'external_identities.observed_at'),
    updatedAt: stringValue(row.updated_at, 'external_identities.updated_at'),
  }
}

function membershipRow(value: unknown): DirectoryMembershipRow {
  const row = objectValue(value)
  return {
    userId: stringValue(row.user_id, 'user_departments.user_id'),
    departmentId: stringValue(row.department_id, 'user_departments.department_id'),
    orgId: stringValue(row.org_id, 'user_departments.org_id'),
    isPrimary: booleanValue(row.is_primary),
    source: optionalString(row.source) || 'manual',
    joinedAt: stringValue(row.joined_at, 'user_departments.joined_at'),
  }
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalValue(item)]),
  )
}

export function canonicalDirectoryJson(value: unknown) {
  return JSON.stringify(canonicalValue(value))
}

export function sha256DirectoryValue(value: unknown) {
  return createHash('sha256').update(canonicalDirectoryJson(value)).digest('hex')
}

function normalizeSnapshotStatus(
  value: string,
  provider: OrganizationConnectionProvider,
) {
  return getDirectoryAdapter(provider).normalizeDirectoryStatus(value)
}

function conflict(
  kind: string,
  externalId: string | null,
  message: string,
  candidateUserIds?: string[],
): DirectoryCutoverConflict {
  return { kind, externalId, message, ...(candidateUserIds ? { candidateUserIds } : {}) }
}

function topologicalDepartments(
  departments: DirectoryPreview['departments'],
  conflicts: DirectoryCutoverConflict[],
) {
  const byId = new Map<string, DirectoryPreview['departments'][number]>()
  for (const department of departments) {
    if (byId.has(department.id)) {
      conflicts.push(conflict('duplicate_department', department.id, `提供方返回了重复部门标识：${department.id}`))
      continue
    }
    byId.set(department.id, department)
  }
  for (const department of byId.values()) {
    if (department.parentId && !byId.has(department.parentId)) {
      conflicts.push(conflict('missing_parent_department', department.id, `部门“${department.name}”的上级不在完整快照中。`))
    }
  }
  const visiting = new Set<string>()
  const visited = new Set<string>()
  const ordered: DirectoryPreview['departments'] = []
  const visit = (department: DirectoryPreview['departments'][number]) => {
    if (visited.has(department.id)) return
    if (visiting.has(department.id)) {
      conflicts.push(conflict('department_cycle', department.id, `部门“${department.name}”存在循环上下级。`))
      return
    }
    visiting.add(department.id)
    if (department.parentId) {
      const parent = byId.get(department.parentId)
      if (parent) visit(parent)
    }
    visiting.delete(department.id)
    visited.add(department.id)
    ordered.push(department)
  }
  for (const department of byId.values()) visit(department)
  return ordered
}

function changedDepartmentFields(
  existing: DirectoryDepartmentRow,
  incoming: DirectoryPreview['departments'][number],
  existingById: Map<string, DirectoryDepartmentRow>,
  provider: OrganizationConnectionProvider,
) {
  const fields: string[] = []
  if (existing.name !== incoming.name) fields.push('name')
  const existingParentExternalId = existing.parentId ? existingById.get(existing.parentId)?.externalId || null : null
  if (existingParentExternalId !== incoming.parentId) fields.push('parent')
  if (normalizeSnapshotStatus(existing.status, provider) !== normalizeSnapshotStatus(incoming.status, provider)) fields.push('status')
  return fields
}

function compareProfileSnapshot(existing: Record<string, unknown>, next: Record<string, unknown>) {
  return canonicalDirectoryJson(existing) === canonicalDirectoryJson(next) ? [] : ['profile']
}

function isEmployeeActive(employee: DirectoryPreview['employees'][number], provider: OrganizationConnectionProvider) {
  return normalizeSnapshotStatus(employee.status, provider) === 'active'
}

// A new directory person receives a stable internal UUID before the immutable plan is confirmed.
// It never adopts an existing account by name, phone or email.
function directoryMemberId(orgId: string, sourceId: string, externalUserId: string) {
  const bytes = createHash('sha1')
    .update(Buffer.from('6ba7b8129dad11d180b400c04fd430c8', 'hex'))
    .update(`price-v3:directory-person:${orgId}:${sourceId}:${externalUserId}`).digest().subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function buildDirectoryCutoverPlan(input: DirectoryCutoverInput): DirectoryCutoverPlanPayload {
  const targetProvider = input.snapshot.provider
  const targetLabel = getConnectionAdapter(targetProvider).label
  const conflicts: DirectoryCutoverConflict[] = []
  const notices: string[] = [
    `手工维护数据和旧来源目录不会被删除；本次只更新${targetLabel}来源及其成员关系。`,
  ]
  const targetSource = input.sources.find(source => source.id === input.targetSourceId)
  if (!targetSource || targetSource.provider !== targetProvider) {
    conflicts.push(conflict('target_source_missing', null, `${targetLabel}来源记录不存在或与快照不一致。`))
  } else {
    if (targetSource.configurationRevision !== input.connectionRevision) {
      conflicts.push(conflict('connection_changed', null, '连接配置已改变，请重新验证并生成计划。'))
    }
    if (!input.connectionVerified) {
      conflicts.push(conflict('connection_not_effective', null, `${targetLabel}连接必须通过本次企业验证及完整目录读取后才能生成同步计划。`))
    }
    if (targetSource.externalTenantId !== input.snapshot.externalTenantId) {
      conflicts.push(conflict('external_tenant_mismatch', null, '连接企业标识与目录快照不一致，请重新验证。'))
    }
  }

  if (!input.snapshot.complete) {
    conflicts.push(conflict('incomplete_snapshot', null, '部门或成员快照结构不完整，不能生成可执行的切源计划。'))
  }
  const declaredDirectorySources = input.sources.filter(source => source.authorityScope.directory === 'authoritative' || source.authorityScope.directory === true)
  const activePrimaries = declaredDirectorySources.length ? declaredDirectorySources : input.sources.filter(source => source.status === 'active' && source.priority === 1 && source.syncMode === 'authoritative')
  if (activePrimaries.length > 1) {
    conflicts.push(conflict('ambiguous_primary_source', null, '当前组织存在多个主来源，必须先人工处理。'))
  }
  const previousPrimary = activePrimaries.length === 1 ? activePrimaries[0] : null
  if (previousPrimary?.provider === targetProvider && previousPrimary.id === input.targetSourceId) {
    notices.push(`${targetLabel}当前已是唯一目录主来源；本计划只核对目录差异并按需刷新可用状态。`)
  }

  const targetDepartments = input.departments.filter(department => department.source === targetProvider)
  const targetById = new Map(targetDepartments.map(department => [department.id, department]))
  const targetByExternalId = new Map<string, DirectoryDepartmentRow>()
  for (const department of targetDepartments) {
    if (!department.externalId) {
      conflicts.push(conflict('target_department_without_external_id', department.id, `系统内${targetLabel}部门“${department.name}”缺少外部标识。`))
      continue
    }
    if (targetByExternalId.has(department.externalId)) {
      conflicts.push(conflict('duplicate_target_department', department.externalId, `系统内同一${targetLabel}部门标识对应了多条部门记录。`))
      continue
    }
    targetByExternalId.set(department.externalId, department)
  }

  const orderedDepartments = topologicalDepartments(input.snapshot.departments, conflicts)
  const unknownDepartmentStatuses = orderedDepartments.filter(department => (
    normalizeSnapshotStatus(department.status, targetProvider) === 'unknown'
  ))
  if (unknownDepartmentStatuses.length) {
    conflicts.push(conflict(
      'unknown_department_status',
      null,
      `${unknownDepartmentStatuses.length} 个${targetLabel}部门的生命周期状态无法识别，必须先补齐状态映射。`,
    ))
  }
  const incomingDepartmentIds = new Set(orderedDepartments.map(department => department.id))
  const departmentChanges = orderedDepartments.map((department): DirectoryCutoverDepartmentChange => {
    const existing = targetByExternalId.get(department.id) || null
    const changedFields = existing ? changedDepartmentFields(existing, department, targetById, targetProvider) : ['created']
    return {
      kind: existing ? (changedFields.length ? 'updated' : 'unchanged') : 'added',
      externalId: department.id,
      existingDepartmentId: existing?.id || null,
      name: department.name,
      parentExternalId: department.parentId,
      status: normalizeSnapshotStatus(department.status, targetProvider) === 'active' ? 'active' : 'inactive',
      changedFields,
    }
  })
  // Absence in a returned directory is not a lifecycle instruction.
  const staleTargetDepartmentIds: string[] = []
  const missingDepartments = targetDepartments.filter(department => department.externalId && !incomingDepartmentIds.has(department.externalId))
  if (missingDepartments.length) {
    notices.push(`${missingDepartments.length} 个历史部门未出现在本次读取中，保留现状供核对；不会仅凭缺失删除或停用。`)
  }

  const usersById = new Map(input.users.map(user => [user.id, user]))
  const identityIndex = buildIdentityIndex(input.users)
  const targetIdentities = input.identities.filter(identity => identity.sourceId === input.targetSourceId)
  const targetIdentityByExternalId = new Map(targetIdentities.map(identity => [identity.externalUserId, identity]))
  const incomingEmployeeIds = new Set<string>()
  const employeesByCanonicalUser = new Map<string, string[]>()
  const identityChanges: DirectoryCutoverIdentityChange[] = []
  const userDepartmentChanges: DirectoryCutoverUserDepartmentChange[] = []

  for (const employee of input.snapshot.employees) {
    if (normalizeSnapshotStatus(employee.status, targetProvider) === 'unknown') {
      conflicts.push(conflict(
        'unknown_employee_status',
        employee.id,
        `员工“${employee.name}”的在职状态无法识别，必须先补齐状态映射。`,
      ))
    }
    if (incomingEmployeeIds.has(employee.id)) {
      conflicts.push(conflict('duplicate_employee', employee.id, `提供方返回了重复员工标识：${employee.id}`))
      continue
    }
    incomingEmployeeIds.add(employee.id)
    if (!employee.departmentIds.length) {
      conflicts.push(conflict('employee_without_department', employee.id, `员工“${employee.name}”没有部门关系。`))
      continue
    }
    if (employee.departmentIds.some(departmentId => !incomingDepartmentIds.has(departmentId))) {
      conflicts.push(conflict('employee_missing_department', employee.id, `员工“${employee.name}”引用了快照中不存在的部门。`))
      continue
    }
    if (!employee.primaryDepartmentId) {
      conflicts.push(conflict('employee_without_primary_department', employee.id, `员工“${employee.name}”缺少明确的主属部门，禁止按部门数组顺序猜测。`))
      continue
    }
    if (!employee.departmentIds.includes(employee.primaryDepartmentId)) {
      conflicts.push(conflict('employee_primary_department_mismatch', employee.id, `员工“${employee.name}”的主属部门不在其部门关系中。`))
      continue
    }

    const existingIdentity = targetIdentityByExternalId.get(employee.id) || null
    const evidenceMatch = resolveIdentityMatch(identityIndex, {
      employeeId: employee.employeeNumber,
      email: employee.email,
      phone: employee.phone,
    })
    let canonicalUserId: string | null = null
    let matchMethod: DirectoryCutoverIdentityChange['matchMethod'] = 'none'
    let confidence = 0

    if (existingIdentity && ['conflict', 'ignored'].includes(existingIdentity.matchStatus)) {
      conflicts.push(conflict(
        'identity_requires_manual_resolution',
        employee.id,
        `员工“${employee.name}”的${targetLabel}历史身份处于冲突或忽略状态，需先人工处理。`,
        existingIdentity.canonicalUserId ? [existingIdentity.canonicalUserId] : undefined,
      ))
      continue
    }
    if (existingIdentity?.matchStatus === 'matched' && existingIdentity.canonicalUserId) {
      canonicalUserId = existingIdentity.canonicalUserId
      matchMethod = existingIdentity.matchMethod === 'manual' ? 'manual' : 'provider_id'
      confidence = existingIdentity.matchMethod === 'manual' ? existingIdentity.matchConfidence : 1
      if (existingIdentity.profileSnapshot.provisionedMemberId !== canonicalUserId && evidenceMatch.kind === 'unique' && evidenceMatch.userId !== canonicalUserId) {
        conflicts.push(conflict(
          'identity_mapping_changed',
          employee.id,
          `员工“${employee.name}”的受信资料与既有${targetLabel}身份映射指向不同成员。`,
          [canonicalUserId, evidenceMatch.userId],
        ))
        canonicalUserId = null
      }
    }

    if (canonicalUserId && !usersById.has(canonicalUserId)) {
      conflicts.push(conflict('identity_user_missing', employee.id, `员工“${employee.name}”关联的系统成员不属于当前组织。`, [canonicalUserId]))
      continue
    }
    const createsMember = canonicalUserId === null
    if (createsMember) {
      canonicalUserId = directoryMemberId(input.organizationId, input.targetSourceId, employee.id)
      if (usersById.has(canonicalUserId)) {
        conflicts.push(conflict('directory_member_collision', employee.id, '目录人员标识已被占用，请核对既有来源映射。'))
        continue
      }
      matchMethod = 'none'
      confidence = 0
    }
    if (!canonicalUserId) continue
    const canonicalEmployees = employeesByCanonicalUser.get(canonicalUserId) || []
    canonicalEmployees.push(employee.id)
    employeesByCanonicalUser.set(canonicalUserId, canonicalEmployees)
    const incomingProfileSnapshot = {
      directorySyncVersion: DIRECTORY_CUTOVER_CONTRACT,
      ...(createsMember ? { provisionedMemberId: canonicalUserId } : {}),
      provider: targetProvider,
      externalUserId: employee.id,
      displayName: employee.name,
      employeeNumber: employee.employeeNumber || null,
      email: employee.email || null,
      phone: employee.phone || null,
      departmentExternalIds: [...employee.departmentIds].sort(),
      primaryDepartmentExternalId: employee.primaryDepartmentId,
      status: normalizeSnapshotStatus(employee.status, targetProvider),
      loginDisabled: employee.loginDisabled,
    }
    const profileSnapshot = existingIdentity
      ? { ...existingIdentity.profileSnapshot, ...incomingProfileSnapshot }
      : incomingProfileSnapshot
    const changedFields = existingIdentity
      ? [
          ...(existingIdentity.canonicalUserId === canonicalUserId ? [] : ['canonicalUser']),
          ...(existingIdentity.matchStatus === 'matched' ? [] : ['matchStatus']),
          ...(existingIdentity.matchMethod === matchMethod ? [] : ['matchMethod']),
          ...compareProfileSnapshot(existingIdentity.profileSnapshot, profileSnapshot),
        ]
      : ['created']
    identityChanges.push({
      kind: existingIdentity ? (changedFields.length ? 'updated' : 'unchanged') : 'added',
      externalUserId: employee.id,
      existingIdentityId: existingIdentity?.id || null,
      canonicalUserId,
      createsMember,
      displayName: employee.name,
      matchMethod,
      confidence,
      departmentExternalIds: [...employee.departmentIds],
      active: isEmployeeActive(employee, targetProvider),
      profileSnapshot,
      changedFields,
    })
    userDepartmentChanges.push({
      userId: canonicalUserId,
      externalUserId: employee.id,
      departmentExternalIds: [...employee.departmentIds],
      primaryDepartmentExternalId: employee.primaryDepartmentId,
      active: isEmployeeActive(employee, targetProvider),
    })
  }

  const staleTargetIdentityIds = targetIdentities
    .filter(identity => !incomingEmployeeIds.has(identity.externalUserId))
    .map(identity => identity.id)
    .sort()
  if (staleTargetIdentityIds.length) {
    notices.push(`${staleTargetIdentityIds.length} 条历史${targetLabel}身份未出现在新快照中，会保留供人工核对，不会静默删除或改写成员。`)
  }

  for (const [canonicalUserId, externalIds] of employeesByCanonicalUser) {
    if (externalIds.length <= 1) continue
    conflicts.push(conflict(
      'canonical_user_duplicate',
      null,
      `同一系统成员对应多个${targetLabel}员工标识：${externalIds.join(', ')}`,
      [canonicalUserId],
    ))
  }

  const affectedUserIds = new Set(userDepartmentChanges.map(change => change.userId))
  const affectedUsers = input.users
    .filter(user => affectedUserIds.has(user.id))
    .map(user => ({
      id: user.id,
      primaryDepartmentId: user.primaryDepartmentId,
      status: user.status,
      loginEnabled: user.loginEnabled,
      updatedAt: user.updatedAt,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const affectedMemberships = input.memberships
    .filter(membership => affectedUserIds.has(membership.userId))
    .sort((left, right) => `${left.userId}:${left.departmentId}`.localeCompare(`${right.userId}:${right.departmentId}`))

  const beforeState: DirectoryStateSnapshot = {
    sources: [...input.sources].sort((left, right) => left.id.localeCompare(right.id)),
    targetDepartments: [...targetDepartments].sort((left, right) => left.id.localeCompare(right.id)),
    targetIdentities: [...targetIdentities].sort((left, right) => left.id.localeCompare(right.id)),
    users: affectedUsers,
    memberships: affectedMemberships,
    organizationMemberships: input.organizationMemberships.filter(row => affectedUserIds.has(row.userId)).sort((a, b) => a.userId.localeCompare(b.userId)),
  }
  const preserved = {
    manualDepartmentCount: input.departments.filter(department => department.source === 'manual').length,
    otherSourceDepartmentCount: input.departments.filter(department => department.source !== targetProvider).length,
    otherSourceIdentityCount: input.identities.filter(identity => identity.sourceId !== input.targetSourceId).length,
    previousPrimaryDepartmentsRetained: previousPrimary
      ? input.departments.filter(department => department.source === previousPrimary.provider).length
      : 0,
    previousPrimaryIdentitiesRetained: previousPrimary
      ? input.identities.filter(identity => identity.sourceId === previousPrimary.id).length
      : 0,
  }
  const directoryHash = sha256DirectoryValue({
    provider: input.snapshot.provider,
    externalTenantId: input.snapshot.externalTenantId,
    checkedAt: input.snapshot.checkedAt,
    departments: input.snapshot.departments,
    employees: input.snapshot.employees,
  })
  const sourceRevisions = input.sources
    .map(source => ({
      id: source.id,
      provider: source.provider,
      priority: source.priority,
      status: source.status,
      syncMode: source.syncMode,
      configurationRevision: source.configurationRevision,
      updatedAt: source.updatedAt,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const summary = {
    departmentsAdded: departmentChanges.filter(change => change.kind === 'added').length,
    departmentsUpdated: departmentChanges.filter(change => change.kind === 'updated').length,
    departmentsUnchanged: departmentChanges.filter(change => change.kind === 'unchanged').length,
    departmentsToDeactivate: staleTargetDepartmentIds.length,
    identitiesAdded: identityChanges.filter(change => change.kind === 'added').length,
    identitiesUpdated: identityChanges.filter(change => change.kind === 'updated').length,
    identitiesUnchanged: identityChanges.filter(change => change.kind === 'unchanged').length,
    conflicts: conflicts.length,
  }
  const body = {
    version: DIRECTORY_CUTOVER_CONTRACT,
    organizationId: input.organizationId,
    targetProvider,
    targetSourceId: input.targetSourceId,
    targetExternalTenantId: input.snapshot.externalTenantId,
    connectionRevision: input.connectionRevision,
    previousPrimarySourceId: previousPrimary?.id || null,
    sourceRevisions,
    snapshot: {
      checkedAt: input.snapshot.checkedAt,
      complete: input.snapshot.complete,
      connectionVerified: input.connectionVerified,
      scopeVerified: input.snapshot.scopeVerified,
      scopeEvidence: input.snapshot.scopeEvidence,
      directoryHash,
      departmentCount: input.snapshot.departments.length,
      employeeCount: input.snapshot.employees.length,
      warnings: [...input.snapshot.warnings],
    },
    summary,
    conflicts,
    notices,
    departmentChanges,
    staleTargetDepartmentIds,
    identityChanges,
    userDepartmentChanges,
    preserved,
    beforeState,
    applyable: conflicts.length === 0 && input.snapshot.complete && input.connectionVerified,
  } as Omit<DirectoryCutoverPlanPayload, 'planHash'>
  return { ...body, planHash: sha256DirectoryValue(body) }
}

async function loadCurrentState(orgId: string): Promise<CurrentState> {
  const [sourceResult, departmentResult, userResult, identityResult, membershipResult, organizationMembershipResult] = await Promise.all([
    supabaseAdmin.from('organization_sources').select([
      'id', 'system_org_id', 'provider', 'external_tenant_id', 'priority', 'status',
      'authority_scope', 'sync_mode', 'configuration_revision', 'connection_state',
      'effective_revision', 'draft_check_status', 'last_successful_sync_at',
      'last_error', 'last_error_at', 'updated_at',
    ].join(',')).eq('system_org_id', orgId),
    supabaseAdmin.from('departments').select('id, org_id, parent_id, name, code, path, depth, external_id, source, status, sort_order, member_count, updated_at').eq('org_id', orgId),
    supabaseAdmin.from('users').select('id, org_id, email, phone, employee_id, display_name, title, avatar_url, status, primary_dept_id, login_enabled, updated_at').eq('org_id', orgId),
    supabaseAdmin.from('external_identities').select('id, source_id, system_org_id, external_user_id, external_union_id, external_open_id, canonical_user_id, match_status, match_method, match_confidence, profile_snapshot, observed_at, updated_at').eq('system_org_id', orgId),
    supabaseAdmin.from('user_departments').select('user_id, department_id, org_id, is_primary, source, joined_at').eq('org_id', orgId),
    supabaseAdmin.from('user_organizations').select('user_id, org_id, primary_department_id, status, employment_status, is_default, created_at').eq('org_id', orgId),
  ])
  for (const result of [sourceResult, departmentResult, userResult, identityResult, membershipResult, organizationMembershipResult]) {
    if (result.error) throw storageFailure()
  }
  return {
    organizationId: orgId,
    sources: (sourceResult.data || []).map(sourceRow),
    departments: (departmentResult.data || []).map(departmentRow),
    users: (userResult.data || []).map(userRow),
    identities: (identityResult.data || []).map(identityRow),
    memberships: (membershipResult.data || []).map(membershipRow),
    organizationMemberships: (organizationMembershipResult.data || []).map(value => {
      const row = objectValue(value)
      return {
        userId: stringValue(row.user_id, 'membership.user_id'), orgId: stringValue(row.org_id, 'membership.org_id'),
        primaryDepartmentId: optionalString(row.primary_department_id), status: stringValue(row.status, 'membership.status'),
        employmentStatus: stringValue(row.employment_status, 'membership.employment_status'), isDefault: row.is_default === true,
        createdAt: stringValue(row.created_at, 'membership.created_at'),
      }
    }),
  }
}

function clientPlan(value: unknown, run?: unknown): DirectoryCutoverClientPlan | null {
  const plan = objectValue(value)
  const payload = objectValue(plan.plan_payload)
  if (payload.version !== DIRECTORY_CUTOVER_CONTRACT) return null
  const provider = payload.targetProvider
  if (!isConfigurableProvider(provider)) return null
  const identityChanges = Array.isArray(payload.identityChanges)
    ? payload.identityChanges.map(item => {
        const entry = objectValue(item)
        const { profileSnapshot: _profileSnapshot, ...safe } = entry
        return safe as Omit<DirectoryCutoverIdentityChange, 'profileSnapshot'>
      })
    : []
  return {
    id: stringValue(plan.id, 'plan.id'),
    planHash: stringValue(plan.plan_hash, 'plan.plan_hash'),
    contractVersion: DIRECTORY_CUTOVER_CONTRACT,
    provider,
    targetSourceId: stringValue(payload.targetSourceId, 'plan.targetSourceId'),
    targetExternalTenantId: stringValue(payload.targetExternalTenantId, 'plan.targetExternalTenantId'),
    connectionRevision: stringValue(payload.connectionRevision, 'plan.connectionRevision'),
    previousPrimarySourceId: optionalString(payload.previousPrimarySourceId),
    sourceRevisions: Array.isArray(payload.sourceRevisions) ? payload.sourceRevisions as DirectoryCutoverPlanPayload['sourceRevisions'] : [],
    createdAt: stringValue(plan.created_at, 'plan.created_at'),
    expiresAt: stringValue(plan.expires_at, 'plan.expires_at'),
    status: ['planned', 'applied', 'superseded', 'rolled_back'].includes(String(plan.status)) ? plan.status as DirectoryCutoverClientPlan['status'] : 'planned',
    applyable: payload.applyable === true,
    snapshot: payload.snapshot as DirectoryCutoverPlanPayload['snapshot'],
    summary: payload.summary as DirectoryCutoverPlanPayload['summary'],
    conflicts: Array.isArray(payload.conflicts) ? payload.conflicts as DirectoryCutoverConflict[] : [],
    notices: Array.isArray(payload.notices) ? payload.notices.filter((item): item is string => typeof item === 'string') : [],
    departmentChanges: Array.isArray(payload.departmentChanges) ? payload.departmentChanges as DirectoryCutoverDepartmentChange[] : [],
    identityChanges,
    preserved: payload.preserved as DirectoryCutoverPlanPayload['preserved'],
    appliedAt: optionalString(plan.applied_at),
    rolledBackAt: optionalString(plan.rolled_back_at),
    run: run ? runResult(run) : null,
  }
}

function runResult(value: unknown): DirectoryCutoverRunResult {
  const run = objectValue(value)
  return {
    runId: stringValue(run.id, 'run.id'),
    planId: stringValue(run.plan_id, 'run.plan_id'),
    status: run.status === 'rolled_back' ? 'rolled_back' : 'applied',
    appliedAt: stringValue(run.applied_at, 'run.applied_at'),
    rolledBackAt: optionalString(run.rolled_back_at),
    sourceId: stringValue(run.target_source_id, 'run.target_source_id'),
    previousPrimarySourceId: optionalString(run.previous_primary_source_id),
    departments: integerValue(run.department_count),
    identities: integerValue(run.identity_count),
    members: integerValue(run.member_count),
  }
}

export async function prepareDirectoryCutoverPlan(input: {
  orgId: string
  actorId: string
  provider: string
}) {
  await assertDirectoryCutoverStorage()
  const connection = await loadOrganizationConnection(input.orgId, input.provider)
  if (!connection) {
    throw new OrganizationConnectionError('CONFIGURATION_REQUIRED', '请先保存来源连接。', 409)
  }
  const read = await readOrganizationDirectory({
    orgId: input.orgId, provider: input.provider,
    sourceId: connection.sourceId, revision: connection.revision,
  })
  const current = await loadCurrentState(input.orgId)
  const target = current.sources.find(source => source.id === read.binding.sourceId)
  if (!target || target.updatedAt !== read.sourceUpdatedAt
    || target.configurationRevision !== read.binding.connectionRevision
    || target.externalTenantId !== read.binding.externalTenantId) {
    throw new OrganizationConnectionError('CONFIG_CHANGED', '读取后连接发生变化，请重新生成计划。', 409)
  }
  const payload = buildDirectoryCutoverPlan({
    ...current, targetSourceId: read.binding.sourceId,
    connectionRevision: read.binding.connectionRevision, connectionVerified: true,
    snapshot: { ...read.directory, provider: read.binding.provider, externalTenantId: read.binding.externalTenantId, applied: false },
  })
  const now = new Date()
  const expiresAt = new Date(now.getTime() + PLAN_LIFETIME_MS).toISOString()
  const result = await supabaseAdmin
    .rpc('store_organization_directory_cutover_plan_v1', {
      p_system_org_id: input.orgId,
      p_target_source_id: read.binding.sourceId,
      p_connection_revision: read.binding.connectionRevision,
      p_previous_primary_source_id: payload.previousPrimarySourceId,
      p_directory_hash: payload.snapshot.directoryHash,
      p_plan_hash: payload.planHash,
      p_plan_payload: payload,
      p_actor_id: input.actorId,
      p_expires_at: expiresAt,
    })
    .single()
  if (result.error || !result.data) {
    if (result.error?.code === '23505') {
      throw new OrganizationConnectionError('DUPLICATE_PLAN', '同一目录计划已经存在，请重新读取。', 409)
    }
    throw storageFailure()
  }
  return clientPlan(result.data)
}

function assertUuid(value: unknown, label: string) {
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new OrganizationConnectionError('INVALID_INPUT', `${label}无效。`, 400)
  }
  return value
}

function safeRpcFailure(error: { message?: string } | null) {
  const message = error?.message || ''
  if (/not found/i.test(message)) return new OrganizationConnectionError('PLAN_NOT_FOUND', '切源计划不存在或不属于当前组织。', 404)
  if (/stale|changed|expired/i.test(message)) return new OrganizationConnectionError('PLAN_STALE', '目录、连接或来源已发生变化，请重新预览差异。', 409)
  if (/later changes/i.test(message)) return new OrganizationConnectionError('ROLLBACK_STALE', '切源后目录或来源已有新变化，当前计划不能自动回滚。', 409)
  if (/not applyable|conflict|incomplete/i.test(message)) return new OrganizationConnectionError('PLAN_BLOCKED', '计划仍包含冲突或快照不完整，不能应用。', 409)
  return new OrganizationConnectionError('CUTOVER_FAILED', '目录切源事务未完成，系统已保持原状态。', 503)
}

export async function applyDirectoryCutoverPlan(input: {
  orgId: string
  actorId: string
  planId: string
  planHash: string
  connectionRevision: string
  sourceRevisions: DirectoryCutoverPlanPayload['sourceRevisions']
}) {
  await assertDirectoryCutoverStorage()
  const planId = assertUuid(input.planId, '切源计划')
  const connectionRevision = assertUuid(input.connectionRevision, '连接版本')
  if (!/^[a-f0-9]{64}$/.test(input.planHash)) {
    throw new OrganizationConnectionError('INVALID_INPUT', '计划摘要无效。', 400)
  }
  if (!Array.isArray(input.sourceRevisions) || input.sourceRevisions.length === 0) {
    throw new OrganizationConnectionError('INVALID_INPUT', '来源版本快照缺失。', 400)
  }
  const { data, error } = await supabaseAdmin.rpc('apply_organization_directory_cutover_v1', {
    p_system_org_id: input.orgId,
    p_plan_id: planId,
    p_plan_hash: input.planHash,
    p_connection_revision: connectionRevision,
    p_source_revisions: input.sourceRevisions,
    p_actor_id: input.actorId,
  })
  if (error || !data) throw safeRpcFailure(error)
  return runResult(data)
}

export async function rollbackDirectoryCutover(input: {
  orgId: string
  actorId: string
  planId: string
}) {
  await assertDirectoryCutoverStorage()
  const planId = assertUuid(input.planId, '切源计划')
  const { data, error } = await supabaseAdmin.rpc('rollback_organization_directory_cutover_v1', {
    p_system_org_id: input.orgId,
    p_plan_id: planId,
    p_actor_id: input.actorId,
  })
  if (error || !data) throw safeRpcFailure(error)
  return runResult(data)
}

export async function loadLatestDirectoryCutoverPlan(orgId: string, provider: OrganizationConnectionProvider) {
  const source = await loadOrganizationConnection(orgId, provider)
  if (!source) return null
  await assertDirectoryCutoverStorage()
  const result = await supabaseAdmin
    .from('organization_directory_cutover_plans')
    .select('id, plan_hash, plan_payload, status, created_at, expires_at, applied_at, rolled_back_at')
    .eq('system_org_id', orgId)
    .eq('target_source_id', source.sourceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (result.error) throw storageFailure()
  if (!result.data) return null
  const run = await supabaseAdmin
    .from('organization_directory_cutover_runs')
    .select('id, plan_id, status, target_source_id, previous_primary_source_id, department_count, identity_count, member_count, applied_at, rolled_back_at')
    .eq('system_org_id', orgId)
    .eq('plan_id', String(result.data.id))
    .maybeSingle()
  if (run.error) throw storageFailure()
  return clientPlan(result.data, run.data)
}
