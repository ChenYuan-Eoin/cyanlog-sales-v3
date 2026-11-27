// REQ: F003 / WP92. Immutable directory diff, explicit primary-source cutover and rollback.
import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { normalizeIdentityPhone } from '@/lib/fxiaoke/identity'
import {
  buildIdentityIndex,
  resolveIdentityMatch,
  type IdentityCandidate,
} from '@/lib/organization-source-identity'
import { getConnectionAdapter, getDirectoryAdapter, isConfigurableProvider } from './adapters'
import { reconcileDirectoryDepartments } from './directory-reconciliation'
import { readFreshFxiaokeScopeProof } from './fxiaoke-directory-scope'
import { OrganizationConnectionError } from './errors'
import { loadOrganizationConnection, loadVerifiedConnection, readOrganizationDirectory } from './service'
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
  phoneVerified?: boolean
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

function hasEndedOrganizationMembership(membership: { status?: unknown; employmentStatus?: unknown }) {
  return membership.status === 'ended' || membership.employmentStatus === 'ended'
}

export type DirectoryCutoverConflict = {
  kind: string
  externalId: string | null
  message: string
  candidateUserIds?: string[]
  identityReview?: {
    incoming: DirectoryIdentityReviewPerson
    candidates: Array<DirectoryIdentityReviewPerson & { userId: string }>
    factsHash?: string
    keepUserId?: string | null
    linkUserIds?: string[]
    canCreate?: boolean
  }
  primaryReview?: DirectoryPrimaryReview & {
    currentDepartmentName: string | null
    incomingDepartmentName: string
  }
}

type DirectoryIdentityReviewPerson = {
  name: string
  maskedPhone: string | null
  primaryDepartment: string | null
  sources: string[]
}

type DirectoryIdentityReviewOptions = {
  keepUserId: string | null
  linkUserIds: string[]
  canCreate: boolean
}

type DirectoryIdentityDecision = {
  externalUserId: string
  factsHash: string
  choice: 'keep_binding' | 'link_existing' | 'create'
  userId: string | null
}

type DirectoryPrimaryReview = {
  userId: string
  currentDepartmentId: string | null
  incomingDepartmentExternalId: string
}

type DirectoryPrimaryDecision = DirectoryPrimaryReview & {
  externalUserId: string
  choice: 'keep_local' | 'adopt_source'
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
    scopeExpiresAt?: string
    directoryHash: string
    departmentCount: number
    employeeCount: number
    warnings: string[]
    contentHash?: string
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
    membersAdded?: number
    membersLinked?: number
    membersMoved?: number
    membersOffboarded?: number
  }
  conflicts: DirectoryCutoverConflict[]
  reviewConflicts?: DirectoryCutoverConflict[]
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
  snapshot: DirectoryPreview & { scopeExpiresAt?: string }
  /** Only set after current server-side connection verification and a bound directory read. */
  connectionVerified: boolean
  sources: DirectorySourceRow[]
  departments: DirectoryDepartmentRow[]
  users: DirectoryUserRow[]
  identities: DirectoryIdentityRow[]
  memberships: DirectoryMembershipRow[]
  organizationMemberships: DirectoryOrganizationMembership[]
  phoneHistory?: Array<{ userId: string; phone: string }>
  primaryDecisions?: DirectoryPrimaryDecision[]
  identityDecisions?: DirectoryIdentityDecision[]
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
  permissionReviews?: DirectoryPermissionReview[]
  notices: string[]
  departmentChanges: DirectoryCutoverDepartmentChange[]
  identityChanges: Array<Omit<DirectoryCutoverIdentityChange, 'profileSnapshot'>>
  preserved: DirectoryCutoverPlanPayload['preserved']
  authorityReview?: DirectoryAuthorityReviewSummary
  appliedAt?: string | null
  rolledBackAt?: string | null
  run?: DirectoryCutoverRunResult | null
}

export type DirectoryPermissionReview = {
  userId: string
  displayName: string
  revision: string
  permissions: Array<{ permissionCode: string; retainable: boolean }>
}

export type DirectoryPermissionChoice = {
  permissionCode: string
  choice: 'new_baseline' | 'retain_eligible'
}

export type DirectoryAuthorityReviewSummary = {
  members: number
  baselineChanges: number
  rolesForReview: number
  scopesForReview: number
  personalExceptions: number
  automaticRoleSourcesAdded?: number
  automaticRoleSourcesRemoved?: number
  automaticRoleScopeWidenedMembers?: number
  automaticRoleScopeNarrowedMembers?: number
}

function authorityReviewSummary(value: unknown): DirectoryAuthorityReviewSummary {
  const summary = objectValue(value)
  return {
    members: integerValue(summary.members),
    baselineChanges: integerValue(summary.baselineChanges),
    rolesForReview: integerValue(summary.rolesForReview),
    scopesForReview: integerValue(summary.scopesForReview),
    personalExceptions: integerValue(summary.personalExceptions),
    ...(summary.automaticRoleSourcesAdded !== undefined
      ? { automaticRoleSourcesAdded: integerValue(summary.automaticRoleSourcesAdded) } : {}),
    ...(summary.automaticRoleSourcesRemoved !== undefined
      ? { automaticRoleSourcesRemoved: integerValue(summary.automaticRoleSourcesRemoved) } : {}),
    ...(summary.automaticRoleScopeWidenedMembers !== undefined
      ? { automaticRoleScopeWidenedMembers: integerValue(summary.automaticRoleScopeWidenedMembers) } : {}),
    ...(summary.automaticRoleScopeNarrowedMembers !== undefined
      ? { automaticRoleScopeNarrowedMembers: integerValue(summary.automaticRoleScopeNarrowedMembers) } : {}),
  }
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
    phoneVerified: row.phone_verified === true,
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

function hasDirectoryScopeProof(snapshot: { scopeVerified?: unknown; scopeEvidence?: unknown }) {
  return snapshot.scopeVerified === true
    && typeof snapshot.scopeEvidence === 'string'
    && snapshot.scopeEvidence.trim().length > 0
}

function directoryContentHash(snapshot: Pick<DirectoryPreview, 'provider' | 'externalTenantId' | 'scopeVerified' | 'scopeEvidence' | 'departments' | 'employees'>) {
  return sha256DirectoryValue({
    provider: snapshot.provider,
    externalTenantId: snapshot.externalTenantId,
    scopeVerified: snapshot.scopeVerified,
    scopeEvidence: snapshot.scopeEvidence?.trim() ?? null,
    departments: [...snapshot.departments].sort((left, right) => left.id.localeCompare(right.id)),
    employees: snapshot.employees.map(employee => ({
      ...employee, departmentIds: [...new Set(employee.departmentIds)].sort(),
    })).sort((left, right) => left.id.localeCompare(right.id)),
  })
}

function addPhoneOwner(index: Map<string, Set<string>>, phone: string | null, ownerId: string) {
  if (!phone) return
  const owners = index.get(phone) ?? new Set<string>()
  owners.add(ownerId)
  index.set(phone, owners)
}

function maskReviewPhone(value: string | null | undefined) {
  const phone = normalizeIdentityPhone(value)
  return phone ? `${phone.slice(0, 3)}••••${phone.slice(-4)}` : null
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

// Use a stable ID only after the identity decision explicitly calls for a new member.
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
  if (targetProvider === 'fxiaoke' && !hasDirectoryScopeProof(input.snapshot)) {
    conflicts.push(conflict('directory_scope_unverified', null, '读取范围待核实，只可预览。现有成员及归属保持原状。'))
  }
  const declaredDirectorySources = input.sources.filter(source => source.authorityScope.directory === 'authoritative' || source.authorityScope.directory === true)
  const activePrimaries = declaredDirectorySources.length ? declaredDirectorySources : input.sources.filter(source => source.status === 'active' && source.priority === 1 && source.syncMode === 'authoritative')
  if (activePrimaries.length > 1) {
    conflicts.push(conflict('ambiguous_primary_source', null, '当前组织存在多个主来源，必须先人工处理。'))
  }
  const previousPrimary = activePrimaries.length === 1 ? activePrimaries[0] : null
  const canIsolateRows = targetProvider === 'fxiaoke' && previousPrimary?.id === input.targetSourceId
  const reviewConflicts: DirectoryCutoverConflict[] = []
  if (previousPrimary?.provider === targetProvider && previousPrimary.id === input.targetSourceId) {
    notices.push(`${targetLabel}当前已是唯一目录主来源；本计划只核对目录差异并按需刷新可用状态。`)
  }

  const targetDepartments = input.departments.filter(department => department.source === targetProvider)
  const targetById = new Map(targetDepartments.map(department => [department.id, department]))
  const departmentsById = new Map(input.departments.map(department => [department.id, department]))
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

  const departmentConflicts: DirectoryCutoverConflict[] = []
  const orderedDepartments = topologicalDepartments(input.snapshot.departments, departmentConflicts)
  const blockedDepartments = new Set(departmentConflicts.flatMap(item => item.externalId ? [item.externalId] : []))
  if (canIsolateRows) {
    for (const department of orderedDepartments) {
      if (department.parentId && blockedDepartments.has(department.parentId)) {
        blockedDepartments.add(department.id)
      }
    }
    reviewConflicts.push(...departmentConflicts)
  } else {
    conflicts.push(...departmentConflicts)
  }
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
  const departmentNames = new Map(orderedDepartments.map(department => [department.id, department.name]))
  const departmentChanges = orderedDepartments.filter(department => !canIsolateRows || !blockedDepartments.has(department.id)).map((department): DirectoryCutoverDepartmentChange => {
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

  const organizationUsers = input.users.filter(user => user.orgId === input.organizationId)
  const usersById = new Map(organizationUsers.map(user => [user.id, user]))
  const endedMemberIds = new Set(input.organizationMemberships.filter(hasEndedOrganizationMembership).map(row => row.userId))
  const identityIndex = buildIdentityIndex(organizationUsers)
  const targetIdentities = input.identities.filter(identity =>
    identity.sourceId === input.targetSourceId && identity.systemOrgId === input.organizationId)
  const targetIdentityByExternalId = new Map(targetIdentities.map(identity => [identity.externalUserId, identity]))
  const currentPhoneOwners = new Map<string, Set<string>>()
  const observedPhoneOwners = new Map<string, Set<string>>()
  const incomingPhoneOwners = new Map<string, Set<string>>()
  const organizationNames = new Set(organizationUsers.map(user => user.displayName?.trim()).filter(Boolean))
  for (const user of organizationUsers) {
    addPhoneOwner(currentPhoneOwners, normalizeIdentityPhone(user.phone), user.id)
  }
  for (const observation of input.phoneHistory ?? []) {
    addPhoneOwner(observedPhoneOwners, normalizeIdentityPhone(observation.phone), observation.userId)
  }
  for (const identity of input.identities) {
    if (identity.systemOrgId === input.organizationId && identity.canonicalUserId && identity.matchStatus === 'matched') {
      addPhoneOwner(observedPhoneOwners, normalizeIdentityPhone(optionalString(identity.profileSnapshot.phone)), identity.canonicalUserId)
    }
  }
  for (const employee of input.snapshot.employees) {
    addPhoneOwner(incomingPhoneOwners, normalizeIdentityPhone(employee.phone), employee.id)
  }
  const incomingEmployeeIds = new Set<string>()
  const employeesByCanonicalUser = new Map<string, string[]>()
  const identityChanges: DirectoryCutoverIdentityChange[] = []
  const userDepartmentChanges: DirectoryCutoverUserDepartmentChange[] = []
  const employeeConflicts: DirectoryCutoverConflict[] = []
  const organizationMembershipByUser = new Map(input.organizationMemberships
    .filter(row => row.orgId === input.organizationId).map(row => [row.userId, row]))
  const sourceNames = new Map(input.sources
    .filter(row => row.systemOrgId === input.organizationId).map(row => [row.id, row.provider]))
  const identitySourcesByUser = new Map<string, Set<string>>()
  for (const identity of input.identities) {
    const provider = sourceNames.get(identity.sourceId)
    if (!provider || !identity.canonicalUserId || identity.matchStatus !== 'matched'
      || identity.systemOrgId !== input.organizationId) continue
    const sources = identitySourcesByUser.get(identity.canonicalUserId) ?? new Set<string>()
    sources.add(provider)
    identitySourcesByUser.set(identity.canonicalUserId, sources)
  }
  function reviewIdentity(
    kind: string,
    employee: DirectoryPreview['employees'][number],
    message: string,
    candidateIds: string[] = [],
    options?: DirectoryIdentityReviewOptions,
  ): DirectoryCutoverConflict {
    const currentIdentity = targetIdentityByExternalId.get(employee.id)
    const actionable = options && canIsolateRows && hasDirectoryScopeProof(input.snapshot) && (
      options.keepUserId !== null || options.linkUserIds.length > 0 || options.canCreate
    )
    return {
      ...conflict(kind, employee.id, message, candidateIds),
      identityReview: {
        ...(actionable ? {
          ...options,
          factsHash: sha256DirectoryValue({
            kind, organizationId: input.organizationId, sourceId: input.targetSourceId,
            connectionRevision: input.connectionRevision,
            employee: { ...employee, departmentIds: [...employee.departmentIds].sort() }, options,
            binding: currentIdentity ? [currentIdentity.id, currentIdentity.canonicalUserId, currentIdentity.matchStatus] : null,
            candidates: [...candidateIds].sort().map(userId => {
              const user = usersById.get(userId)
              const membership = organizationMembershipByUser.get(userId)
              return {
                userId, phone: normalizeIdentityPhone(user?.phone), verified: user?.phoneVerified === true,
                name: user?.displayName, email: user?.email, employeeId: user?.employeeId,
                status: membership?.status, employmentStatus: membership?.employmentStatus,
              }
            }),
          }),
        } : {}),
        incoming: {
          name: employee.name, maskedPhone: maskReviewPhone(employee.phone), sources: [targetProvider],
          primaryDepartment: departmentNames.get(employee.primaryDepartmentId ?? '') ?? null,
        },
        candidates: candidateIds.flatMap(userId => {
          const user = usersById.get(userId)
          if (!user) return []
          const membership = organizationMembershipByUser.get(userId)
          const departmentId = (membership ? membership.primaryDepartmentId : user.primaryDepartmentId) ?? ''
          return [{
            userId, name: user.displayName ?? '未命名成员', maskedPhone: maskReviewPhone(user.phone),
            primaryDepartment: departmentsById.get(departmentId)?.name ?? null,
            sources: [...(identitySourcesByUser.get(userId) ?? ['manual'])].sort(),
          }]
        }),
      },
    }
  }
  function eligibleIdentityCandidate(userId: string, externalId: string) {
    const membership = organizationMembershipByUser.get(userId)
    return usersById.has(userId) && membership?.status === 'active' && membership.employmentStatus === 'active'
      && !targetIdentities.some(identity => identity.canonicalUserId === userId && identity.externalUserId !== externalId)
  }

  const identityDecisionsByEmployee = new Map((input.identityDecisions ?? []).map(decision =>
    [decision.externalUserId, decision]))
  const primaryDecisionsByEmployee = new Map((input.primaryDecisions ?? []).map(decision =>
    [decision.externalUserId, decision]))
  const providerLinksByUser = new Map<string, string[]>()
  for (const membership of input.memberships) {
    if (membership.source !== targetProvider || membership.orgId !== input.organizationId) continue
    const externalId = targetById.get(membership.departmentId)?.externalId
    if (!externalId) continue
    const links = providerLinksByUser.get(membership.userId) ?? []
    links.push(externalId)
    providerLinksByUser.set(membership.userId, links)
  }
  let endedMembersObserved = 0

  for (const employee of input.snapshot.employees) {
    if (incomingEmployeeIds.has(employee.id)) {
      employeeConflicts.push(conflict('duplicate_employee', employee.id, `提供方返回了重复员工标识：${employee.id}`))
      continue
    }
    incomingEmployeeIds.add(employee.id)
    if (employee.sourceConflict) {
      employeeConflicts.push(reviewIdentity(
        'employee_source_conflict', employee, `员工“${employee.name}”的纷享记录互相矛盾，需核对人员资料或所属部门。`,
      ))
      continue
    }
    if (normalizeSnapshotStatus(employee.status, targetProvider) === 'unknown') {
      employeeConflicts.push(conflict(
        'unknown_employee_status',
        employee.id,
        `员工“${employee.name}”的在职状态无法识别，必须先补齐状态映射。`,
      ))
      continue
    }
    if (!employee.departmentIds.length) {
      employeeConflicts.push(conflict('employee_without_department', employee.id, `员工“${employee.name}”没有部门关系。`))
      continue
    }
    if (employee.departmentIds.some(departmentId => !incomingDepartmentIds.has(departmentId) || blockedDepartments.has(departmentId))) {
      employeeConflicts.push(conflict('employee_missing_department', employee.id, `员工“${employee.name}”的部门需要先核对。`))
      continue
    }
    if (!employee.primaryDepartmentId) {
      employeeConflicts.push(conflict('employee_without_primary_department', employee.id, `员工“${employee.name}”缺少明确的主属部门，禁止按部门数组顺序猜测。`))
      continue
    }
    if (!employee.departmentIds.includes(employee.primaryDepartmentId)) {
      employeeConflicts.push(conflict('employee_primary_department_mismatch', employee.id, `员工“${employee.name}”的主属部门不在其部门关系中。`))
      continue
    }

    const existingIdentity = targetIdentityByExternalId.get(employee.id) || null
    const phone = normalizeIdentityPhone(employee.phone)
    const phoneOwners = phone ? [...(currentPhoneOwners.get(phone) ?? [])] : []
    const historicalPhoneOwners = phone ? [...(observedPhoneOwners.get(phone) ?? [])] : []
    const evidenceMatch = resolveIdentityMatch(identityIndex, {
      employeeId: employee.employeeNumber,
      email: employee.email,
      phone: targetProvider === 'fxiaoke' ? null : employee.phone,
    })
    let canonicalUserId: string | null = null
    let matchMethod: DirectoryCutoverIdentityChange['matchMethod'] = 'none'
    let confidence = 0
    let preserveBoundContact = false
    const selectedIdentityDecision = identityDecisionsByEmployee.get(employee.id)

    if (existingIdentity && ['conflict', 'ignored'].includes(existingIdentity.matchStatus)) {
      employeeConflicts.push(reviewIdentity(
        'identity_requires_manual_resolution',
        employee,
        `员工“${employee.name}”的${targetLabel}历史身份处于冲突或忽略状态，需先人工处理。`,
        existingIdentity.canonicalUserId ? [existingIdentity.canonicalUserId] : undefined,
      ))
      continue
    }
    if (targetProvider === 'fxiaoke' && phone && (incomingPhoneOwners.get(phone)?.size ?? 0) > 1) {
      employeeConflicts.push(reviewIdentity('identity_phone_duplicate', employee, `员工“${employee.name}”的手机号同时对应多条纷享身份，需先核对。`, phoneOwners))
      continue
    }
    if (existingIdentity?.matchStatus === 'matched' && existingIdentity.canonicalUserId) {
      canonicalUserId = existingIdentity.canonicalUserId
      matchMethod = existingIdentity.matchMethod === 'manual' ? 'manual' : 'provider_id'
      confidence = existingIdentity.matchMethod === 'manual' ? existingIdentity.matchConfidence : 1
      const contraryPhone = targetProvider === 'fxiaoke'
        && [...phoneOwners, ...historicalPhoneOwners].some(owner => owner !== canonicalUserId)
      const contraryEvidence = existingIdentity.profileSnapshot.provisionedMemberId !== canonicalUserId
        && evidenceMatch.kind === 'unique' && evidenceMatch.userId !== canonicalUserId
      if (contraryPhone || contraryEvidence) {
        const otherOwners = [...new Set([
          ...(contraryEvidence && evidenceMatch.kind === 'unique' ? [evidenceMatch.userId] : []),
          ...(contraryPhone ? [...phoneOwners, ...historicalPhoneOwners].filter(owner => owner !== canonicalUserId) : []),
        ])]
        const review = reviewIdentity(
          'identity_mapping_changed',
          employee,
          `员工“${employee.name}”的受信资料与既有${targetLabel}身份映射指向不同成员。`,
          [canonicalUserId, ...otherOwners],
          { keepUserId: eligibleIdentityCandidate(canonicalUserId, employee.id) ? canonicalUserId : null, linkUserIds: [], canCreate: false },
        )
        if (!review.identityReview?.factsHash || selectedIdentityDecision?.factsHash !== review.identityReview.factsHash
          || selectedIdentityDecision.choice !== 'keep_binding' || selectedIdentityDecision.userId !== review.identityReview.keepUserId) {
          employeeConflicts.push(review)
          continue
        }
        preserveBoundContact = true
      }
    }
    if (targetProvider === 'fxiaoke' && !canonicalUserId) {
      const candidate = phoneOwners.length === 1 ? usersById.get(phoneOwners[0]) : undefined
      const relatedOwners = [...new Set([
        ...phoneOwners,
        ...historicalPhoneOwners,
        ...(evidenceMatch.kind === 'unique' ? [evidenceMatch.userId] : evidenceMatch.candidateIds),
      ])]
      const canLink = candidate?.phoneVerified === true
        && eligibleIdentityCandidate(candidate.id, employee.id)
        && relatedOwners.every(owner => owner === candidate.id)

      if (canLink && candidate) {
        canonicalUserId = candidate.id
        matchMethod = 'phone'
        confidence = 1
      } else if (!phone || relatedOwners.length || organizationNames.has(employee.name.trim()) || !isEmployeeActive(employee, targetProvider)) {
        const candidateIds = relatedOwners.length || !organizationNames.has(employee.name.trim())
          ? relatedOwners
          : organizationUsers.filter(user => user.displayName?.trim() === employee.name.trim()).map(user => user.id)
        const active = isEmployeeActive(employee, targetProvider)
        const review = reviewIdentity(
          'identity_requires_review', employee, `员工“${employee.name}”的身份无法安全确认，需先核对。`, candidateIds,
          {
            keepUserId: null,
            linkUserIds: active ? candidateIds.filter(userId => eligibleIdentityCandidate(userId, employee.id)).sort() : [],
            canCreate: active && candidateIds.length === 0,
          },
        )
        if (!review.identityReview?.factsHash || selectedIdentityDecision?.factsHash !== review.identityReview.factsHash) {
          employeeConflicts.push(review)
          continue
        }
        if (selectedIdentityDecision.choice === 'link_existing' && selectedIdentityDecision.userId
          && review.identityReview.linkUserIds?.includes(selectedIdentityDecision.userId)) {
          canonicalUserId = selectedIdentityDecision.userId
          matchMethod = 'manual'
          confidence = 1
        } else if (selectedIdentityDecision.choice !== 'create' || !review.identityReview.canCreate) {
          employeeConflicts.push(review)
          continue
        }
      }
    }

    if (canonicalUserId && !usersById.has(canonicalUserId)) {
      employeeConflicts.push(conflict('identity_user_missing', employee.id, `员工“${employee.name}”关联的系统成员不属于当前组织。`, [canonicalUserId]))
      continue
    }
    const createsMember = canonicalUserId === null
    if (createsMember) {
      canonicalUserId = directoryMemberId(input.organizationId, input.targetSourceId, employee.id)
      if (usersById.has(canonicalUserId)) {
        employeeConflicts.push(conflict('directory_member_collision', employee.id, '目录人员标识已被占用，请核对既有来源映射。'))
        continue
      }
      matchMethod = 'none'
      confidence = 0
    }
    if (!canonicalUserId) continue
    const canonicalEmployees = employeesByCanonicalUser.get(canonicalUserId) || []
    canonicalEmployees.push(employee.id)
    employeesByCanonicalUser.set(canonicalUserId, canonicalEmployees)
    let departmentExternalIds = [...new Set(employee.departmentIds)].sort()
    let primaryDepartmentExternalId = employee.primaryDepartmentId
    const organizationMembership = organizationMembershipByUser.get(canonicalUserId)
    let updateDepartments = true
    let nextPrimaryBaseline: string | null | undefined
    if (canIsolateRows && !createsMember && !endedMemberIds.has(canonicalUserId)) {
      const currentDepartmentId = (organizationMembership
        ? organizationMembership.primaryDepartmentId : usersById.get(canonicalUserId)?.primaryDepartmentId) ?? null
      const currentPrimary = currentDepartmentId
        ? targetById.get(currentDepartmentId)?.externalId ?? `local:${currentDepartmentId}`
        : null
      const previousProfile = existingIdentity?.profileSnapshot
      const previousPrimary = previousProfile && Object.hasOwn(previousProfile, 'reconciledPrimaryExternalId')
        ? optionalString(previousProfile.reconciledPrimaryExternalId)
        : optionalString(previousProfile?.primaryDepartmentExternalId)
      const providerLinks = providerLinksByUser.get(canonicalUserId) ?? []
      const decision = primaryDecisionsByEmployee.get(employee.id)
      const confirmedChoice = decision?.userId === canonicalUserId && decision.currentDepartmentId === currentDepartmentId
        && decision.incomingDepartmentExternalId === employee.primaryDepartmentId ? decision.choice : null
      const reviewedPair = { current: currentPrimary, incoming: employee.primaryDepartmentId }
      const reconciliation = reconcileDirectoryDepartments({
        previousPrimary, currentPrimary, incomingPrimary: employee.primaryDepartmentId,
        currentProviderDepartmentIds: providerLinks, incomingDepartmentIds: departmentExternalIds,
        retainedPrimary: confirmedChoice === 'keep_local' ? reviewedPair : null,
        adoptedPrimary: confirmedChoice === 'adopt_source' ? reviewedPair : null,
      })
      if (reconciliation.primary.kind === 'review') {
        updateDepartments = false
        employeeConflicts.push({
          ...conflict('employee_primary_review', employee.id, `员工“${employee.name}”的主部门归属需要核对。`, [canonicalUserId]),
          ...(existingIdentity?.canonicalUserId === canonicalUserId && organizationMembership ? { primaryReview: {
            userId: canonicalUserId, currentDepartmentId,
            incomingDepartmentExternalId: employee.primaryDepartmentId,
            currentDepartmentName: currentDepartmentId ? departmentsById.get(currentDepartmentId)?.name ?? null : null,
            incomingDepartmentName: departmentNames.get(employee.primaryDepartmentId) ?? '纷享部门',
          } } : {}),
        })
        if (existingIdentity?.canonicalUserId === canonicalUserId) continue
      } else if (reconciliation.primary.kind === 'preserve_local') {
        updateDepartments = false
      } else {
        departmentExternalIds = reconciliation.effectiveProviderDepartmentIds
        primaryDepartmentExternalId = reconciliation.primary.effective ?? employee.primaryDepartmentId
        const nextActive = isEmployeeActive(employee, targetProvider)
        const currentActive = organizationMembership?.employmentStatus === 'active'
        updateDepartments = primaryDepartmentExternalId !== currentPrimary
          || canonicalDirectoryJson(departmentExternalIds) !== canonicalDirectoryJson([...providerLinks].sort())
          || (organizationMembership !== undefined && currentActive !== nextActive)
      }
      nextPrimaryBaseline = reconciliation.nextPrimaryBaseline
    }
    const incomingProfileSnapshot = {
      directorySyncVersion: DIRECTORY_CUTOVER_CONTRACT,
      ...(createsMember ? { provisionedMemberId: canonicalUserId } : {}),
      provider: targetProvider,
      externalUserId: employee.id,
      displayName: employee.name,
      employeeNumber: preserveBoundContact ? existingIdentity?.profileSnapshot.employeeNumber ?? null : employee.employeeNumber || null,
      email: preserveBoundContact ? existingIdentity?.profileSnapshot.email ?? null : employee.email || null,
      phone: preserveBoundContact ? existingIdentity?.profileSnapshot.phone ?? null : employee.phone || null,
      departmentExternalIds,
      primaryDepartmentExternalId,
      ...(nextPrimaryBaseline === undefined ? {} : { reconciledPrimaryExternalId: nextPrimaryBaseline }),
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
      departmentExternalIds,
      active: isEmployeeActive(employee, targetProvider),
      profileSnapshot,
      changedFields,
    })
    if (endedMemberIds.has(canonicalUserId)) {
      endedMembersObserved += 1
      continue
    }
    if (!updateDepartments) continue
    userDepartmentChanges.push({
      userId: canonicalUserId,
      externalUserId: employee.id,
      departmentExternalIds,
      primaryDepartmentExternalId,
      active: isEmployeeActive(employee, targetProvider),
    })
  }

  if (endedMembersObserved) {
    notices.push(`${endedMembersObserved} 名已在系统办理离职的员工仅更新来源身份资料。`)
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
    employeeConflicts.push(...externalIds.map(externalId => conflict(
      'canonical_user_duplicate', externalId, `同一系统成员对应多个${targetLabel}员工标识，需要先核对。`, [canonicalUserId],
    )))
  }

  if (canIsolateRows) reviewConflicts.push(...employeeConflicts)
  else conflicts.push(...employeeConflicts)
  const excludedEmployees = new Set(employeeConflicts.filter(item => item.kind !== 'employee_primary_review').map(item => item.externalId))
  const applicableIdentities = identityChanges.filter(change => !excludedEmployees.has(change.externalUserId))
  const applicableMemberships = userDepartmentChanges.filter(change => !excludedEmployees.has(change.externalUserId))
  const newlyLinkedIdentities = applicableIdentities.filter(change => !change.createsMember
    && targetIdentityByExternalId.get(change.externalUserId)?.matchStatus !== 'matched'
    && (change.matchMethod === 'phone' || (change.matchMethod === 'manual'
      && identityDecisionsByEmployee.get(change.externalUserId)?.choice === 'link_existing')))
  const affectedUserIds = new Set([
    ...applicableMemberships.map(change => change.userId),
    ...newlyLinkedIdentities.map(change => change.canonicalUserId),
  ])
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
    identitiesAdded: applicableIdentities.filter(change => change.kind === 'added').length,
    identitiesUpdated: applicableIdentities.filter(change => change.kind === 'updated').length,
    identitiesUnchanged: applicableIdentities.filter(change => change.kind === 'unchanged').length,
    conflicts: conflicts.length + reviewConflicts.length,
    membersAdded: applicableIdentities.filter(change => change.createsMember && change.active).length,
    membersLinked: newlyLinkedIdentities.length,
    membersMoved: applicableMemberships.filter(change => change.active && usersById.has(change.userId)
      && targetById.get(organizationMembershipByUser.get(change.userId)?.primaryDepartmentId ?? '')?.externalId
        !== change.primaryDepartmentExternalId).length,
    membersOffboarded: applicableMemberships.filter(change => !change.active
      && organizationMembershipByUser.get(change.userId)?.employmentStatus === 'active').length,
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
      ...(input.snapshot.scopeExpiresAt ? { scopeExpiresAt: input.snapshot.scopeExpiresAt } : {}),
      directoryHash,
      departmentCount: input.snapshot.departments.length,
      employeeCount: input.snapshot.employees.length,
      warnings: [...input.snapshot.warnings],
      contentHash: directoryContentHash(input.snapshot),
    },
    summary,
    conflicts,
    ...(reviewConflicts.length ? { reviewConflicts } : {}),
    notices,
    departmentChanges,
    staleTargetDepartmentIds,
    identityChanges: applicableIdentities,
    userDepartmentChanges: applicableMemberships,
    preserved,
    beforeState,
    applyable: conflicts.length === 0 && (reviewConflicts.length === 0
      || applicableMemberships.length > 0
      || applicableIdentities.some(change => change.kind !== 'unchanged')
      || departmentChanges.some(change => change.kind !== 'unchanged')),
  } as Omit<DirectoryCutoverPlanPayload, 'planHash'>
  return { ...body, planHash: sha256DirectoryValue(body) }
}

async function readDirectoryRows<Row>(
  read: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: unknown }>,
): Promise<Row[]> {
  const all: Row[] = []
  const pageSize = 500
  for (let offset = 0; ; offset += pageSize) {
    const result = await read(offset, offset + pageSize - 1)
    if (result.error) throw storageFailure()
    const rows = result.data ?? []
    all.push(...rows)
    if (rows.length < pageSize) return all
  }
}

async function loadCurrentState(orgId: string, provider: OrganizationConnectionProvider): Promise<CurrentState> {
  const [sources, departments, users, identities, memberships, organizationMemberships, phoneHistory] = await Promise.all([
    readDirectoryRows((from, to) => supabaseAdmin.from('organization_sources').select([
      'id', 'system_org_id', 'provider', 'external_tenant_id', 'priority', 'status',
      'authority_scope', 'sync_mode', 'configuration_revision', 'connection_state',
      'effective_revision', 'draft_check_status', 'last_successful_sync_at',
      'last_error', 'last_error_at', 'updated_at',
    ].join(',')).eq('system_org_id', orgId).order('id').range(from, to)),
    readDirectoryRows((from, to) => supabaseAdmin.from('departments')
      .select('id, org_id, parent_id, name, code, path, depth, external_id, source, status, sort_order, member_count, updated_at')
      .eq('org_id', orgId).order('id').range(from, to)),
    readDirectoryRows((from, to) => supabaseAdmin.from('users')
      .select('id, org_id, email, phone, phone_verified, employee_id, display_name, title, avatar_url, status, primary_dept_id, login_enabled, updated_at')
      .eq('org_id', orgId).order('id').range(from, to)),
    readDirectoryRows((from, to) => supabaseAdmin.from('external_identities')
      .select('id, source_id, system_org_id, external_user_id, external_union_id, external_open_id, canonical_user_id, match_status, match_method, match_confidence, profile_snapshot, observed_at, updated_at')
      .eq('system_org_id', orgId).order('id').range(from, to)),
    readDirectoryRows((from, to) => supabaseAdmin.from('user_departments')
      .select('user_id, department_id, org_id, is_primary, source, joined_at')
      .eq('org_id', orgId).order('user_id').order('department_id').range(from, to)),
    readDirectoryRows((from, to) => supabaseAdmin.from('user_organizations')
      .select('user_id, org_id, primary_department_id, status, employment_status, is_default, created_at')
      .eq('org_id', orgId).order('user_id').range(from, to)),
    provider === 'fxiaoke'
      ? readDirectoryRows((from, to) => supabaseAdmin.from('phone_history')
          .select('user_id,phone').eq('org_id', orgId).order('id').range(from, to))
      : [],
  ])
  return {
    organizationId: orgId,
    phoneHistory: phoneHistory.map(row => ({ userId: row.user_id, phone: row.phone })),
    sources: sources.map(sourceRow),
    departments: departments.map(departmentRow),
    users: users.map(userRow),
    identities: identities.map(identityRow),
    memberships: memberships.map(membershipRow),
    organizationMemberships: organizationMemberships.map(value => {
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

async function loadPrimaryDecisions(orgId: string, sourceId: string) {
  const { data, error } = await supabaseAdmin.rpc('list_fxiaoke_directory_primary_reviews_v1', {
    p_system_org_id: orgId, p_source_id: sourceId,
  })
  if (error || !Array.isArray(data)) throw storageFailure()
  return data as DirectoryPrimaryDecision[]
}

async function loadIdentityDecisions(orgId: string, sourceId: string) {
  const { data, error } = await supabaseAdmin.rpc('list_fxiaoke_directory_identity_reviews_v1', {
    p_system_org_id: orgId, p_source_id: sourceId,
  })
  if (error || !Array.isArray(data)) throw storageFailure()
  return data as DirectoryIdentityDecision[]
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
    applyable: payload.applyable === true
      && (plan.status !== 'planned' || provider !== 'fxiaoke' || hasDirectoryScopeProof(objectValue(payload.snapshot))),
    snapshot: payload.snapshot as DirectoryCutoverPlanPayload['snapshot'],
    summary: payload.summary as DirectoryCutoverPlanPayload['summary'],
    conflicts: ([
      ...(Array.isArray(payload.conflicts) ? payload.conflicts : []),
      ...(Array.isArray(payload.reviewConflicts) ? payload.reviewConflicts : []),
    ] as DirectoryCutoverConflict[]).map(item => {
      if (!item.identityReview) return item
      const { factsHash: _factsHash, ...display } = item.identityReview
      return { ...item, identityReview: display }
    }),
    ...(Array.isArray(payload.permissionReviews) ? { permissionReviews: payload.permissionReviews as DirectoryPermissionReview[] } : {}),
    notices: Array.isArray(payload.notices) ? payload.notices.filter((item): item is string => typeof item === 'string') : [],
    departmentChanges: Array.isArray(payload.departmentChanges) ? payload.departmentChanges as DirectoryCutoverDepartmentChange[] : [],
    identityChanges,
    preserved: payload.preserved as DirectoryCutoverPlanPayload['preserved'],
    ...(payload.authorityReview ? {
      authorityReview: authorityReviewSummary(objectValue(payload.authorityReview).summary),
    } : {}),
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

async function readDirectoryDifference(input: { orgId: string; provider: string; allowEffectiveReadOnly?: boolean }) {
  const connection = await loadOrganizationConnection(input.orgId, input.provider)
  if (!connection) {
    throw new OrganizationConnectionError('CONFIGURATION_REQUIRED', '请先保存来源连接。', 409)
  }
  const revision = connection.effectiveRevision
  if (!connection.effectiveVerified || !revision
    || (!input.allowEffectiveReadOnly && revision !== connection.revision)) {
    throw new OrganizationConnectionError('DIRECTORY_CONNECTION_REQUIRED', '请先检查并启用当前目录连接，再生成同步差异。', 409)
  }
  const read = await readOrganizationDirectory({
    orgId: input.orgId, provider: input.provider,
    sourceId: connection.sourceId, revision,
    ...(input.provider === 'fxiaoke' ? { credentialSource: 'effective' as const } : {}),
  })
  const current = await loadCurrentState(input.orgId, read.binding.provider)
  const target = current.sources.find(source => source.id === read.binding.sourceId)
  if (!target || target.updatedAt !== read.sourceUpdatedAt
    || target.configurationRevision !== read.sourceConfigurationRevision
    || target.externalTenantId !== read.binding.externalTenantId) {
    throw new OrganizationConnectionError('CONFIG_CHANGED', '读取后连接发生变化，请重新生成计划。', 409)
  }
  const [primaryDecisions, identityDecisions] = read.binding.provider === 'fxiaoke'
    ? await Promise.all([loadPrimaryDecisions(input.orgId, read.binding.sourceId), loadIdentityDecisions(input.orgId, read.binding.sourceId)])
    : [[], []]
  const scope = read.binding.provider === 'fxiaoke' ? await readFreshFxiaokeScopeProof(read) : {}
  return buildDirectoryCutoverPlan({
    ...current, targetSourceId: read.binding.sourceId,
    primaryDecisions, identityDecisions,
    connectionRevision: read.binding.connectionRevision, connectionVerified: true,
    snapshot: { ...read.directory, ...scope, provider: read.binding.provider, externalTenantId: read.binding.externalTenantId, applied: false },
  })
}

export function readFxiaokeDirectoryDifference(orgId: string) {
  return readDirectoryDifference({ orgId, provider: 'fxiaoke', allowEffectiveReadOnly: true })
}

export async function prepareDirectoryCutoverPlan(input: {
  orgId: string
  actorId: string
  provider: string
}) {
  await assertDirectoryCutoverStorage()
  const payload = await readDirectoryDifference(input)
  const now = Date.now()
  const scopeExpiresAt = payload.snapshot.scopeExpiresAt ? Date.parse(payload.snapshot.scopeExpiresAt) : Number.POSITIVE_INFINITY
  if (scopeExpiresAt <= now) {
    throw new OrganizationConnectionError('DIRECTORY_SCOPE_UNVERIFIED', '目录范围证据已过期，请重新核对。', 409)
  }
  const expiresAt = new Date(Math.min(now + PLAN_LIFETIME_MS, scopeExpiresAt)).toISOString()
  const result = await supabaseAdmin
    .rpc('store_organization_directory_authority_plan_v1', {
      p_system_org_id: input.orgId,
      p_target_source_id: payload.targetSourceId,
      p_connection_revision: payload.connectionRevision,
      p_previous_primary_source_id: payload.previousPrimarySourceId,
      p_directory_hash: payload.snapshot.directoryHash,
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

function safeRpcFailure(error: { code?: string; details?: string; message?: string } | null) {
  if (error?.details === 'DIRECTORY_PERMISSION_REVIEW_STALE') {
    return new OrganizationConnectionError('PLAN_STALE', '人员归属或个人权限已变化，请重新核对。', 409)
  }
  if (error?.details === 'DIRECTORY_PERMISSION_REVIEW_REQUIRED') {
    return new OrganizationConnectionError('DIRECTORY_PERMISSION_REVIEW_REQUIRED', '请重新生成差异并核对受影响的个人权限。', 409)
  }
  if (error?.details === 'DIRECTORY_REVIEW_STALE' || error?.details === 'DIRECTORY_IDENTITY_REVIEW_STALE') {
    return new OrganizationConnectionError('PLAN_STALE', '成员归属或确认单已变化，请重新核对。', 409)
  }
  if (error?.code === '42501') {
    return new OrganizationConnectionError('FORBIDDEN', '当前账号无权确认此组织的变更。', 403)
  }
  if (error?.details === 'DIRECTORY_SCOPE_UNVERIFIED') {
    return new OrganizationConnectionError('DIRECTORY_SCOPE_UNVERIFIED', '读取范围待核实，只可预览。', 409)
  }
  if (error?.details === 'DIRECTORY_ROLLBACK_PREVIEW_STALE') {
    return new OrganizationConnectionError('ROLLBACK_STALE', '目录或权限已变化，请重新预览回滚影响。', 409)
  }
  if (error?.details === 'DIRECTORY_AUTHORITY_PREVIEW_STALE' || error?.details === 'DIRECTORY_AUTHORITY_PROJECTION_CHANGED') {
    return new OrganizationConnectionError('PLAN_STALE', '部门归属或权限已变化，请重新预览目录差异。', 409)
  }
  if (error?.code === '23514' && error.details === 'LAST_SYSTEM_SUPER_ADMIN_PROTECTED') {
    return new OrganizationConnectionError(
      'LAST_SYSTEM_SUPER_ADMIN_PROTECTED',
      '本次目录变更会使组织失去最后一名有效系统超管。请先任命另一名可登录的系统超管，再重试。',
      409,
    )
  }
  const message = error?.message || ''
  if (/not found/i.test(message)) return new OrganizationConnectionError('PLAN_NOT_FOUND', '切源计划不存在或不属于当前组织。', 404)
  if (/stale|changed|expired/i.test(message)) return new OrganizationConnectionError('PLAN_STALE', '目录、连接或来源已发生变化，请重新预览差异。', 409)
  if (/later changes/i.test(message)) return new OrganizationConnectionError('ROLLBACK_STALE', '切源后目录或来源已有新变化，当前计划不能自动回滚。', 409)
  if (/not applyable|conflict|incomplete/i.test(message)) return new OrganizationConnectionError('PLAN_BLOCKED', '计划仍包含冲突或快照不完整，不能应用。', 409)
  return new OrganizationConnectionError('CUTOVER_FAILED', '目录切源事务未完成，系统已保持原状态。', 503)
}

export async function saveFxiaokeDirectoryPrimaryReview(input: {
  orgId: string
  actorId: string
  planId: string
  planHash: string
  externalUserId: string
  choice: unknown
}) {
  const planId = assertUuid(input.planId, '差异确认单')
  if (!/^[a-f0-9]{64}$/.test(input.planHash) || !input.externalUserId || input.externalUserId.length > 255
    || (input.choice !== 'keep_local' && input.choice !== 'adopt_source')) {
    throw new OrganizationConnectionError('INVALID_INPUT', '请提供有效的主部门核对选择。', 400)
  }
  const { data, error } = await supabaseAdmin.rpc('save_fxiaoke_directory_primary_review_v1', {
    p_system_org_id: input.orgId, p_actor_id: input.actorId,
    p_plan_id: planId, p_plan_hash: input.planHash, p_external_user_id: input.externalUserId, p_choice: input.choice,
  })
  if (error || !data) throw safeRpcFailure(error)
  return data
}

export async function saveFxiaokeDirectoryIdentityReview(input: {
  orgId: string
  actorId: string
  planId: string
  planHash: string
  externalUserId: string
  choice: unknown
  userId: unknown
  evidence: unknown
}) {
  const planId = assertUuid(input.planId, '差异确认单')
  const evidence = typeof input.evidence === 'string' ? input.evidence.trim() : ''
  if (!/^[a-f0-9]{64}$/.test(input.planHash) || !input.externalUserId || input.externalUserId.length > 255
    || (input.choice !== 'keep_binding' && input.choice !== 'link_existing' && input.choice !== 'create')
    || evidence.length < 4 || evidence.length > 500 || (input.choice === 'create' && input.userId != null)) {
    throw new OrganizationConnectionError('INVALID_INPUT', '请提供有效的身份处理选择与核对说明。', 400)
  }
  const userId = input.choice === 'create' ? null : assertUuid(input.userId, 'ICU 成员')
  const { data, error } = await supabaseAdmin.rpc('save_fxiaoke_directory_identity_review_v1', {
    p_system_org_id: input.orgId, p_actor_id: input.actorId,
    p_plan_id: planId, p_plan_hash: input.planHash, p_external_user_id: input.externalUserId,
    p_choice: input.choice, p_user_id: userId, p_evidence: evidence,
  })
  if (error || !data) throw safeRpcFailure(error)
  const { factsHash: _factsHash, ...receipt } = objectValue(data)
  return receipt
}

export async function saveFxiaokeDirectoryPermissionReview(input: {
  orgId: string
  actorId: string
  planId: string
  planHash: string
  userId: unknown
  choices: DirectoryPermissionChoice[]
}) {
  const planId = assertUuid(input.planId, '差异确认单')
  const userId = assertUuid(input.userId, 'ICU 成员')
  if (!/^[a-f0-9]{64}$/.test(input.planHash)) {
    throw new OrganizationConnectionError('INVALID_INPUT', '差异确认单已失效，请重新检查。', 400)
  }
  const { data, error } = await supabaseAdmin.rpc('save_fxiaoke_directory_permission_review_v1', {
    p_system_org_id: input.orgId, p_actor_id: input.actorId,
    p_plan_id: planId, p_plan_hash: input.planHash, p_user_id: userId, p_choices: input.choices,
  })
  if (error || !data) throw safeRpcFailure(error)
  return data
}

export async function applyDirectoryCutoverPlan(input: {
  orgId: string
  actorId: string
  planId: string
  planHash: string
  connectionRevision: string
  sourceRevisions: DirectoryCutoverPlanPayload['sourceRevisions']
  beforeWrite?: () => Promise<void>
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
  const stored = await supabaseAdmin.from('organization_directory_cutover_plans')
    .select('status,target_source_id,plan_payload').eq('id', planId)
    .eq('system_org_id', input.orgId).maybeSingle()
  if (stored.error || !stored.data) throw new OrganizationConnectionError('PLAN_NOT_FOUND', '切源计划不存在或不属于当前组织。', 404)
  // Already-applied retries still reach the transaction's original idempotency check.
  if (stored.data.status === 'planned') {
    const payload = objectValue(stored.data.plan_payload)
    if (payload.targetProvider === 'fxiaoke' && !hasDirectoryScopeProof(objectValue(payload.snapshot))) {
      throw new OrganizationConnectionError('DIRECTORY_SCOPE_UNVERIFIED', '读取范围待核实，只可预览。', 409)
    }
    const previousMemberships = objectValue(payload.beforeState).organizationMemberships
    const userDepartmentChanges = payload.userDepartmentChanges
    if (Array.isArray(previousMemberships) && Array.isArray(userDepartmentChanges)) {
      const endedMemberIds = new Set(previousMemberships.map(objectValue)
        .filter(hasEndedOrganizationMembership).map(membership => membership.userId))
      if (userDepartmentChanges.some(change => endedMemberIds.has(objectValue(change).userId))) {
        throw new OrganizationConnectionError('PLAN_STALE', '计划包含已离职成员的部门归属更新，请重新读取目录差异。', 409)
      }
    }
    const connection = await loadVerifiedConnection({
      orgId: input.orgId, provider: String(payload.targetProvider || ''),
      sourceId: String(stored.data.target_source_id),
    })
    if (connection.revision !== connectionRevision) {
      throw new OrganizationConnectionError('PLAN_STALE', '生效连接与差异计划不一致，请启用当前配置后重新生成差异。', 409)
    }
    if (payload.targetProvider === 'fxiaoke') {
      const preview = objectValue(payload.snapshot)
      if (typeof preview.contentHash !== 'string') {
        throw new OrganizationConnectionError('PLAN_STALE', '请重新读取目录差异再确认。', 409)
      }
      const latest = await readOrganizationDirectory({
        orgId: input.orgId, provider: payload.targetProvider,
        sourceId: String(stored.data.target_source_id), revision: connectionRevision,
        credentialSource: 'effective',
      })
      const scope = await readFreshFxiaokeScopeProof(latest)
      if (!latest.directory.complete || !hasDirectoryScopeProof(scope)) {
        throw new OrganizationConnectionError('DIRECTORY_SCOPE_UNVERIFIED', '读取范围待核实，只可预览。', 409)
      }
      if (latest.binding.externalTenantId !== payload.targetExternalTenantId || directoryContentHash({
        ...latest.directory, ...scope, provider: latest.binding.provider, externalTenantId: latest.binding.externalTenantId,
      }) !== preview.contentHash) {
        throw new OrganizationConnectionError('PLAN_STALE', '纷享目录已变化，请重新读取并核对差异。', 409)
      }
    }
  }
  await input.beforeWrite?.()
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

export async function previewDirectoryRollback(input: {
  orgId: string
  actorId: string
  planId: string
}) {
  await assertDirectoryCutoverStorage()
  const planId = assertUuid(input.planId, '切源计划')
  const { data, error } = await supabaseAdmin.rpc('preview_organization_directory_rollback_v1', {
    p_system_org_id: input.orgId,
    p_plan_id: planId,
    p_actor_id: input.actorId,
  })
  if (error || !data) throw safeRpcFailure(error)
  const preview = objectValue(data)
  return {
    previewId: assertUuid(preview.previewId, '回滚确认凭据'),
    expiresAt: stringValue(preview.expiresAt, 'preview.expiresAt'),
    summary: authorityReviewSummary(preview.summary),
  }
}

export async function rollbackDirectoryCutover(input: {
  orgId: string
  actorId: string
  planId: string
  previewId: string
}) {
  await assertDirectoryCutoverStorage()
  const planId = assertUuid(input.planId, '切源计划')
  const previewId = assertUuid(input.previewId, '回滚确认凭据')
  const { data, error } = await supabaseAdmin.rpc('confirm_organization_directory_rollback_v1', {
    p_system_org_id: input.orgId,
    p_plan_id: planId,
    p_actor_id: input.actorId,
    p_preview_id: previewId,
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
