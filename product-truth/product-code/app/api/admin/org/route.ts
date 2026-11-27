// REQ:F003 - Organization Admin API
// PURPOSE: 组织架构管理

export const preferredRegion = 'sin1'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { buildDepartmentSpaces } from '@/lib/department-spaces'
import { readDirectoryRosterSource, verifyDirectoryRoster } from '@/lib/organization-directory-roster'
import { readOrganizationPermissionDecision, resolveOrganizationPermissionDecision } from '@/lib/admin/employee-organization-permissions'
import { loadOrgRolePermissionContext, queryOrgRoles } from '@/lib/org-role-permissions'
import { getMemberActionAvailability, loadOrganizationPermissionAccess, type MemberActionAvailability } from '@/lib/admin/member-actions'
import { evaluateDepartmentStructureAccess } from '@/lib/admin/department-actions'
import type { ScopeType } from '@/lib/scoped-access'
import type { DepartmentAutomaticRoleSource } from '@/app/configs/types'

type RoleLookup = {
  id: string
  code: string
  name: string
  sort_order?: number | null
}

type OrgDepartmentRow = {
  id: string
  name: string
  code: string | null
  depth: number | null
  member_count: number | null
  parent_id: string | null
  leader_id: string | null
}

type SalesSpaceRow = {
  id: string
  name: string
  description: string | null
  department_id: string
  owner_id: string | null
}

type OrgUserIdRow = {
  id?: string
  user_id?: string
}

type OrgContext = {
  orgId: string
  memberAccess: boolean
  memberActions: MemberActionAvailability
  departmentAccess: ReturnType<typeof evaluateDepartmentStructureAccess>
}

type OrgAdminPayload = {
  organization: unknown
  users: unknown[]
  departments: Parameters<typeof buildDepartmentSpaces>[0]
  roles: unknown[]
  spaces: Parameters<typeof buildDepartmentSpaces>[1]
}

function hideDepartmentMembership(user: unknown) {
  if (!user || typeof user !== 'object') return user
  const member = user as Record<string, unknown>
  const scopedRoles = Array.isArray(member.scoped_roles)
    ? member.scoped_roles.filter(role => role?.scopeType === 'org')
    : []
  return {
    ...member,
    primary_dept_id: null,
    primary_dept_name: '',
    department_ids: [],
    secondary_dept_names: [],
    automatic_role_sources: undefined,
    scoped_roles: scopedRoles,
    role_ids: scopedRoles.map(role => role.roleId).filter(id => typeof id === 'string'),
    role_codes: scopedRoles.map(role => role.roleCode).filter(code => typeof code === 'string'),
    role_names: scopedRoles.map(role => role.roleName).filter(name => typeof name === 'string').join(', '),
  }
}

type TimingEntry = {
  name: string
  durationMs: number
}

async function withTiming<T>(entries: TimingEntry[], name: string, fn: () => Promise<T>): Promise<T> {
  const startedAt = performance.now()
  try {
    return await fn()
  } finally {
    entries.push({
      name,
      durationMs: performance.now() - startedAt,
    })
  }
}

function formatTimingHeader(entries: TimingEntry[], totalStartedAt: number) {
  const timingParts = entries.map((entry) => (
    `${entry.name};dur=${entry.durationMs.toFixed(1)}`
  ))
  timingParts.push(`total;dur=${(performance.now() - totalStartedAt).toFixed(1)}`)
  return timingParts.join(', ')
}

function errorResponse(message: string, status: number, code?: string, extra?: Record<string, unknown>) {
  const headers = status === 405 ? { Allow: 'GET' } : undefined
  return NextResponse.json({ error: message, code, ...extra }, { status, headers })
}

function isOrgAdminPayload(value: unknown): value is OrgAdminPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<OrgAdminPayload>
  return (
    Array.isArray(payload.users)
    && Array.isArray(payload.departments)
    && Array.isArray(payload.roles)
    && Array.isArray(payload.spaces)
  )
}

type OrgPayloadSource = 'directory-v2' | 'directory-v1' | 'legacy-rpc' | 'fallback'

const automaticRoleDirectorySourcesSchema = z.array(z.object({
  user_id: z.string().min(1),
  role_id: z.string().min(1),
  role_code: z.string().min(1),
  role_name: z.string().min(1),
  rule_department_id: z.string().min(1),
  affiliation_department_id: z.string().min(1),
  permissions: z.array(z.string().min(1)).min(1),
}))

async function readAutomaticRoleDirectorySources(orgId: string, payload: OrgAdminPayload) {
  try {
    const { data, error } = await supabaseAdmin.rpc('department_automatic_role_directory_sources_v1', { p_org_id: orgId })
    if (error && ['PGRST202', '42883'].includes(error.code || '')) return null
    if (error) throw error

    const parsed = automaticRoleDirectorySourcesSchema.safeParse(data)
    if (!parsed.success) throw new Error('INVALID_AUTOMATIC_ROLE_DIRECTORY_SOURCES')

    const departmentNames = new Map(payload.departments.map(department => [department.id, department.name]))
    const roleIds = new Set(payload.roles.flatMap(role =>
      role && typeof role === 'object' && 'id' in role ? [role.id] : []))
    const byMember = new Map<string, DepartmentAutomaticRoleSource[]>()
    const seen = new Set<string>()
    for (const source of parsed.data) {
      const { user_id, role_id, role_name, rule_department_id, affiliation_department_id } = source
      const ruleDepartmentName = departmentNames.get(rule_department_id)
      const affiliationDepartmentName = departmentNames.get(affiliation_department_id)
      if (!roleIds.has(role_id) || !ruleDepartmentName || !affiliationDepartmentName) continue
      const key = JSON.stringify([user_id, role_id, rule_department_id, affiliation_department_id])
      if (seen.has(key)) continue
      seen.add(key)

      const sources = byMember.get(user_id) ?? []
      sources.push({
        roleId: role_id, roleName: role_name,
        ruleDepartmentId: rule_department_id, ruleDepartmentName,
        affiliationDepartmentId: affiliation_department_id, affiliationDepartmentName,
      })
      byMember.set(user_id, sources)
    }
    return byMember
  } catch (error) {
    console.error('[admin/org] Automatic role sources read failed:', error instanceof Error ? error.message : 'RPC_ERROR')
    return false as const
  }
}

async function listOrgPayloadFromRpc(orgId: string): Promise<{ data: OrgAdminPayload; source: OrgPayloadSource }> {
  let source: OrgPayloadSource = 'directory-v2'
  let result = await supabaseAdmin.rpc('get_org_admin_directory_payload_v2', { p_org_id: orgId })
  if (result.error && ['PGRST202', '42883'].includes(result.error.code || '')) {
    source = 'directory-v1'
    result = await supabaseAdmin.rpc('get_org_admin_directory_payload_v1', { p_org_id: orgId })
  }
  let { data, error } = result
  if (error && ['PGRST202', '42883'].includes(error.code || '')) {
    source = 'legacy-rpc'
    const legacy = await supabaseAdmin.rpc('get_org_admin_payload_v1', { p_org_id: orgId })
    data = legacy.data
    error = legacy.error
  } else if (error || !isOrgAdminPayload(data)) {
    throw new Error('ORG_DIRECTORY_READ_FAILED')
  }

  if (error || !isOrgAdminPayload(data)) {
    throw new Error('ORG_PAYLOAD_RPC_FAILED')
  }

  return { data, source }
}

async function readRoleMembershipBasis(orgId: string, source: OrgPayloadSource, organization: unknown) {
  const unavailable = {
    effectiveAvailable: false, pendingAvailable: false, activeSpaceIds: [], activeMemberIds: [],
    systemSuperAdminAssignableMemberIds: [],
  }
  if (!organization || typeof organization !== 'object' || !('id' in organization) || organization.id !== orgId) {
    return unavailable
  }
  const pendingAvailable = source === 'directory-v2'
  if (!pendingAvailable && source !== 'directory-v1') return unavailable

  try {
    const [organizationState, spaces, members] = await Promise.all([
      supabaseAdmin.from('organizations').select('id,status').eq('id', orgId).maybeSingle(),
      supabaseAdmin.from('sales_spaces').select('id', { count: 'exact' })
        .eq('org_id', orgId).eq('status', 'active'),
      supabaseAdmin.from('user_organizations')
        .select('user_id,is_default,user:users!user_organizations_user_id_fkey!inner(status,login_enabled)', { count: 'exact' })
        .eq('org_id', orgId).eq('status', 'active').eq('employment_status', 'active').is('left_at', null)
        .eq('user.status', 'active').eq('user.login_enabled', true),
    ])
    if (organizationState.error || organizationState.data?.id !== orgId || organizationState.data.status !== 'active') {
      return unavailable
    }
    if (spaces.error || !Array.isArray(spaces.data) || spaces.count !== spaces.data.length
      || members.error || !Array.isArray(members.data) || members.count !== members.data.length) return { ...unavailable, pendingAvailable }
    return {
      effectiveAvailable: true,
      pendingAvailable,
      activeSpaceIds: spaces.data.map(space => space.id),
      activeMemberIds: members.data.map(member => member.user_id),
      systemSuperAdminAssignableMemberIds: members.data.filter(member => member.is_default === true).map(member => member.user_id),
    }
  } catch {
    return { ...unavailable, pendingAvailable }
  }
}

async function getOrgDepartments(orgId: string): Promise<OrgDepartmentRow[]> {
  const { data, error } = await supabaseAdmin
    .from('departments')
    .select('id, name, code, depth, member_count, parent_id, leader_id')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .order('depth', { ascending: true })
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error('DEPARTMENTS_FETCH_FAILED')
  }

  return (data || []) as OrgDepartmentRow[]
}

async function getOrgRoles(orgId: string): Promise<RoleLookup[]> {
  const { data, error } = await queryOrgRoles(orgId)
    .select('id, code, name, sort_order')
    .order('sort_order').order('id')

  if (error) {
    throw new Error('ROLES_FETCH_FAILED')
  }

  return (data || []) as RoleLookup[]
}

async function getOrgSalesSpaces(orgId: string): Promise<SalesSpaceRow[]> {
  const { data, error } = await supabaseAdmin
    .from('sales_spaces')
    .select('id, name, description, department_id, owner_id')
    .eq('org_id', orgId)
    .order('name', { ascending: true })

  if (error) {
    throw new Error('SPACES_FETCH_FAILED')
  }

  return (data || []) as SalesSpaceRow[]
}

async function getOrganization(orgId: string) {
  const { data, error } = await supabaseAdmin
    .from('organizations')
    .select('id, name, slug')
    .eq('id', orgId)
    .single()

  if (error) {
    throw new Error('ORG_FETCH_FAILED')
  }

  return data
}

async function getOrgUserIds(orgId: string): Promise<string[]> {
  const [membershipResult, directResult] = await Promise.all([
    supabaseAdmin
      .from('user_organizations')
      .select('user_id')
      .eq('org_id', orgId),
    supabaseAdmin
      .from('users')
      .select('id')
      .eq('org_id', orgId),
  ])

  if (membershipResult.error || directResult.error) {
    throw new Error('ORG_USERS_FETCH_FAILED')
  }

  return Array.from(new Set([
    ...((membershipResult.data || []) as OrgUserIdRow[]).map((row) => row.user_id),
    ...((directResult.data || []) as OrgUserIdRow[]).map((row) => row.id),
  ].filter((id): id is string => Boolean(id))))
}

async function getOrgUserRoles(orgId: string, orgUserIds?: string[]) {
  const ids = orgUserIds ?? await getOrgUserIds(orgId)
  if (ids.length === 0) {
    return []
  }

  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .select('user_id, scope_type, scope_id, granted_at, role_id')
    .eq('org_id', orgId)
    .in('user_id', ids)

  if (error) {
    console.error('[getCachedUserRoles] Role fetch error:', error)
    throw new Error('USER_ROLES_FETCH_FAILED')
  }

  return data || []
}

async function canAssignOrganizationRoles(userId: string, orgId: string, roleCodes: string[]) {
  if (!roleCodes.includes('SUPER_ADMIN')) return false
  // Projection only: missing authority should hide the authorization controls,
  // without interrupting unrelated organization and member reads.
  const authority = await loadOrgRolePermissionContext(userId).catch(() => null)
  return authority?.orgId === orgId && authority.canEditPlatformRoot
}

async function requireOrgAdmin(req: NextRequest): Promise<OrgContext | null> {
  const headerUserId = req.headers.get('x-user-id')?.trim()
  const headerOrgId = req.headers.get('x-org-id')?.trim()
  if (headerUserId && headerOrgId) {
    const roleCodes = (
      req.headers.get('x-user-role-codes')
      || req.headers.get('x-user-roles')
      || ''
    ).split(',').map((code) => code.trim()).filter(Boolean)
    const permissions = (req.headers.get('x-user-permissions') || '')
      .split(',')
      .map((permission) => permission.trim())
      .filter(Boolean)

    const assignRoles = await canAssignOrganizationRoles(headerUserId, headerOrgId, roleCodes)
    const decision = readOrganizationPermissionDecision(req.headers) ?? resolveOrganizationPermissionDecision(permissions)
    const memberActions = getMemberActionAvailability(decision, assignRoles)
    const memberAccess = decision['user:view']
    const departmentAccess = evaluateDepartmentStructureAccess(decision)
    if (!memberAccess && !departmentAccess.canRead) return null

    return {
      // Middleware resolves permissions and org from the same exact-org DB
      // snapshot. Do not mix those permissions with a separately cached org.
      orgId: headerOrgId,
      memberAccess,
      memberActions,
      departmentAccess,
    }
  }

  const user = await requireAuth(req)
  const access = await loadOrganizationPermissionAccess(user.id)
  if (!access) return null
  const { orgId, decision, systemAdministrator } = access
  const memberActions = getMemberActionAvailability(decision, systemAdministrator)
  const memberAccess = decision['user:view']
  const departmentAccess = evaluateDepartmentStructureAccess(decision)
  if (!memberAccess && !departmentAccess.canRead) return null

  return { orgId, memberAccess, memberActions, departmentAccess }
}

// 优化后的列表查询 - 使用缓存和简化查询
async function listOrgPayload(orgId: string) {
  const [departments, roles, spaces, organization, orgUserIds] = await Promise.all([
    getOrgDepartments(orgId),
    getOrgRoles(orgId),
    getOrgSalesSpaces(orgId),
    getOrganization(orgId),
    getOrgUserIds(orgId),
  ])

  // 构建部门名称映射
  const departmentNameById = new Map(departments.map((d) => [d.id, d.name]))
  const spaceNameById = new Map(spaces.map((s) => [s.id, s.name]))

  let usersData: Array<{
    id: string
    email: string | null
    phone: string | null
    display_name: string
    title: string | null
    status: string
    primary_dept_id: string | null
    login_enabled: boolean | null
    report_to_user_id: string | null
    created_at?: string
  }> = []

  if (orgUserIds.length > 0) {
    const { data, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, email, phone, display_name, title, status, primary_dept_id, login_enabled, report_to_user_id, created_at')
      .in('id', orgUserIds)
      .neq('status', 'inactive')
      .order('created_at', { ascending: false })
      .limit(200)

    if (usersError) {
      throw new Error('USERS_FETCH_FAILED')
    }

    usersData = data || []
  }

  // 构建用户姓名映射（用于查找部门主管）
  const userNameById = new Map(usersData.map((u) => [u.id, u.display_name]))

  const userRolesData = await getOrgUserRoles(orgId, orgUserIds)
  const departmentIds = new Set(departments.map((department) => department.id))
  const spaceIds = new Set(spaces.map((space) => space.id))

  // 构建角色映射
  // 角色映射（预留，用于后续扩展）
  const roleById = new Map(roles.map(role => [role.id, role]))

  // 构建用户角色映射
  const userRolesMap = new Map<string, typeof userRolesData>()
  for (const ur of userRolesData) {
    const entry = ur as unknown as {
      user_id: string
      scope_type?: ScopeType
      scope_id?: string | null
    }
    const scopeId = entry.scope_id
    const isCurrentOrgScope = (
      (entry.scope_type === 'org' && (!scopeId || scopeId === orgId))
      || (entry.scope_type === 'department' && typeof scopeId === 'string' && departmentIds.has(scopeId))
      || (entry.scope_type === 'space' && typeof scopeId === 'string' && spaceIds.has(scopeId))
    )
    if (!isCurrentOrgScope) {
      continue
    }

    const userId = entry.user_id
    if (!userRolesMap.has(userId)) {
      userRolesMap.set(userId, [])
    }
    userRolesMap.get(userId)!.push(ur)
  }

  // 处理用户数据
  const users = usersData.map((row) => {
    const userRoleEntries = (userRolesMap.get(row.id) || [])
      .map((ur: unknown) => {
        const entry = ur as {
          scope_type: string
          scope_id: string | null
          granted_at: string | null
          role_id: string
        }
        const role = roleById.get(entry.role_id)
        if (!role?.code) return null

        let scopeName = '组织'
        if (entry.scope_type === 'department' && entry.scope_id) {
          scopeName = departmentNameById.get(entry.scope_id) || '部门'
        } else if (entry.scope_type === 'space' && entry.scope_id) {
          scopeName = spaceNameById.get(entry.scope_id) || '销售空间'
        }

        return {
          roleId: role.id,
          roleName: role.name,
          roleCode: role.code,
          scopeType: entry.scope_type as ScopeType,
          scopeId: entry.scope_id,
          scopeName,
          grantedAt: entry.granted_at,
        }
      })
      .filter(Boolean) as {
        roleId: string
        roleName: string
        roleCode: string
        scopeType: ScopeType
        scopeId: string | null
        scopeName: string
        grantedAt: string | null
      }[]

    return {
      id: row.id,
      email: row.email || '',
      phone: row.phone || '',
      display_name: row.display_name,
      title: row.title || '',
      primary_dept_id: row.primary_dept_id,
      primary_dept_name: row.primary_dept_id
        ? departmentNameById.get(row.primary_dept_id) || '-'
        : '-',
      role_names: userRoleEntries
        .map((r) => (r.scopeType === 'org' ? r.roleName : `${r.roleName}(${r.scopeName})`))
        .join(', '),
      role_ids: userRoleEntries.filter((r) => r.scopeType === 'org').map((r) => r.roleId),
      role_codes: userRoleEntries.filter((r) => r.scopeType === 'org').map((r) => r.roleCode),
      scoped_roles: userRoleEntries,
      status: row.status,
      login_enabled: row.login_enabled ?? true,
      report_to_user_id: row.report_to_user_id || null,
      report_to_user_name: row.report_to_user_id ? (userNameById.get(row.report_to_user_id) || null) : null,
    }
  })

  return {
    organization: organization,
    users,
    departments: departments.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      depth: row.depth || 0,
      member_count: row.member_count || 0,
      parent_id: row.parent_id,
      parent_name: row.parent_id ? departmentNameById.get(row.parent_id) || null : null,
      leader_id: row.leader_id,
      leader_name: row.leader_id ? userNameById.get(row.leader_id) || null : null,
    })),
    roles: roles.map((r) => ({ id: r.id, code: r.code, name: r.name })),
    spaces: spaces.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      department_id: s.department_id,
      department_name: departmentNameById.get(s.department_id) || '',
      owner_id: s.owner_id,
    })),
  }
}

export async function GET(req: NextRequest) {
  const totalStartedAt = performance.now()
  const timings: TimingEntry[] = []
  let payloadSource: OrgPayloadSource = 'fallback'

  try {
    const auth = await withTiming(timings, 'auth', () => requireOrgAdmin(req))
    if (!auth) {
      return errorResponse('无权限访问组织管理', 403, 'FORBIDDEN')
    }

    if (!auth.memberAccess) {
      const departments = await getOrgDepartments(auth.orgId)
      const names = new Map(departments.map(department => [department.id, department.name]))
      return NextResponse.json({
        departments: departments.map(({ id, name, code, depth, parent_id }) => ({
          id, name, code, depth, parent_id,
          parent_name: parent_id ? names.get(parent_id) ?? null : null,
        })),
        users: [],
        roles: [],
        spaces: [],
        member_access: false,
        member_actions: auth.memberActions,
        department_access: auth.departmentAccess,
      }, { headers: { 'Cache-Control': 'no-store' } })
    }

    const directorySource = await readDirectoryRosterSource(auth.orgId)
    let data: OrgAdminPayload
    try {
      const result = await withTiming(timings, 'rpc_payload', () => listOrgPayloadFromRpc(auth.orgId))
      data = result.data
      payloadSource = result.source
    } catch (rpcError) {
      if (rpcError instanceof Error && rpcError.message === 'ORG_DIRECTORY_READ_FAILED') throw rpcError
      console.error('[admin/org] RPC payload failed; falling back to query fan-out:', rpcError)
      data = await withTiming(timings, 'fallback_payload', () => listOrgPayload(auth.orgId))
    }

    const canReadDepartments = auth.departmentAccess.canRead
    const org = data.organization as Record<string, unknown> | null
    const [directoryRoster, roleMembershipBasis, automaticRoleSources] = await Promise.all([
      verifyDirectoryRoster(auth.orgId, directorySource, data),
      readRoleMembershipBasis(auth.orgId, payloadSource, data.organization),
      canReadDepartments && org?.id === auth.orgId
        ? withTiming(timings, 'role_sources', () => readAutomaticRoleDirectorySources(auth.orgId, data))
        : null,
    ])
    return NextResponse.json({
      ...data,
      organization: org ? { id: org.id, name: org.name, slug: org.slug } : undefined,
      users: canReadDepartments ? data.users.map(user => {
        if (!user || typeof user !== 'object' || !('id' in user) || typeof user.id !== 'string') return user
        return { ...user, automatic_role_sources: automaticRoleSources ? automaticRoleSources.get(user.id) : undefined }
      }) : data.users.map(hideDepartmentMembership),
      departments: canReadDepartments ? data.departments : [],
      spaces: canReadDepartments ? data.spaces : [],
      department_spaces: canReadDepartments ? buildDepartmentSpaces(data.departments, data.spaces) : [],
      directory_roster: directoryRoster.status === 'ready'
        ? { ...directoryRoster, members: directoryRoster.members.map(({ id, departmentIds }) => ({
          id, departmentIds: canReadDepartments ? departmentIds : [],
        })) }
        : directoryRoster,
      role_membership_stats: canReadDepartments ? {
        ...roleMembershipBasis,
        automaticSourcesAvailable: automaticRoleSources === null ? undefined : automaticRoleSources !== false,
      } : { ...roleMembershipBasis, activeSpaceIds: [] },
      member_access: true,
      member_actions: auth.memberActions,
      department_access: auth.departmentAccess,
    }, {
      headers: {
        'Cache-Control': 'no-store',
        'X-Org-Payload-Source': payloadSource === 'fallback' ? 'fallback' : 'rpc',
        'X-Org-Timing': formatTimingHeader(timings, totalStartedAt),
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }

    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

export async function POST() {
  return errorResponse(
    '组织聚合接口仅支持读取；请使用 /api/admin/users 或 /api/admin/departments 执行写操作',
    405,
    'ORG_AGGREGATE_READ_ONLY'
  )
}

export async function PATCH() {
  return errorResponse(
    '组织聚合接口仅支持读取；请使用 /api/admin/users 或 /api/admin/departments 执行写操作',
    405,
    'ORG_AGGREGATE_READ_ONLY'
  )
}
