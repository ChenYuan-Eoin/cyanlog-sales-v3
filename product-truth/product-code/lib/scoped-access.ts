import { supabaseAdmin } from '@/lib/supabase'
import { canAccessOrgAdmin } from '@/lib/permissions'

export type ScopeType = 'org' | 'department' | 'space'

type RoleJoinRow = {
  id?: string | null
  code?: string | null
  name?: string | null
  permissions?: string[] | null
}

type UserRoleRow = {
  scope_type: ScopeType
  scope_id: string | null
  granted_at: string | null
  role: RoleJoinRow | RoleJoinRow[] | null
}

type SalesSpaceMemberRow = {
  space: SalesSpaceSummary | SalesSpaceSummary[] | null
}

type OrgMembershipRow = {
  org_id: string
}

type DepartmentPathRow = {
  id: string
  path: string | null
}

type UserDepartmentMemberRow = {
  user_id: string
}

type UserSummaryRow = {
  id: string
}

type SalesSpaceMemberUserRow = {
  user_id: string
}

type SalesSpaceOwnerRow = {
  owner_id: string | null
}

export interface ScopedRoleAssignment {
  scopeType: ScopeType
  scopeId: string | null
  grantedAt: string | null
  roleId: string
  roleCode: string
  roleName: string
  permissions: string[]
}

export interface SalesSpaceSummary {
  id: string
  name: string
  description: string | null
  department_id: string
  owner_id: string | null
  active_opportunities: number | null
  pending_milestones: number | null
}

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }
  return value ?? null
}

function normalizePermissions(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function mergeSpaces(...groups: SalesSpaceSummary[][]): SalesSpaceSummary[] {
  const byId = new Map<string, SalesSpaceSummary>()

  for (const group of groups) {
    for (const space of group) {
      byId.set(space.id, space)
    }
  }

  return Array.from(byId.values()).sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))))
}

export async function getDefaultOrgId(userId: string): Promise<string> {
  const membershipResult = await supabaseAdmin
    .from('user_organizations')
    .select('org_id')
    .eq('user_id', userId)
    .eq('is_default', true)
    .maybeSingle()

  const membership = membershipResult.data as OrgMembershipRow | null
  if (membershipResult.error) {
    throw membershipResult.error
  }

  if (membership?.org_id) {
    return membership.org_id
  }

  const userResult = await supabaseAdmin
    .from('users')
    .select('org_id')
    .eq('id', userId)
    .maybeSingle()

  if (userResult.error) {
    throw userResult.error
  }

  const userRow = userResult.data as { org_id?: string | null } | null
  if (!userRow?.org_id) {
    throw new Error(`ORG_NOT_FOUND:${userId}`)
  }

  return userRow.org_id
}

async function listDepartmentSubtreeIds(orgId: string, rootDepartmentIds: string[]): Promise<string[]> {
  const roots = uniqueStrings(rootDepartmentIds)
  if (roots.length === 0) {
    return []
  }

  const { data, error } = await supabaseAdmin
    .from('departments')
    .select('id, path')
    .eq('org_id', orgId)

  if (error) {
    throw error
  }

  return ((data || []) as DepartmentPathRow[])
    .filter((department) => (
      roots.includes(department.id)
      || roots.some((rootId) => department.path?.includes(`/${rootId}/`))
    ))
    .map((department) => department.id)
}

export async function getUserScopedRoleAssignments(userId: string): Promise<ScopedRoleAssignment[]> {
  const { data, error } = await supabaseAdmin
    .from('user_roles')
    .select('scope_type, scope_id, granted_at, role:roles(id, code, name, permissions)')
    .eq('user_id', userId)

  if (error) {
    throw error
  }

  return ((data || []) as UserRoleRow[])
    .map((row) => {
      const role = unwrapOne(row.role)
      if (!role?.id || !role.code || !role.name) {
        return null
      }

      return {
        scopeType: row.scope_type,
        scopeId: row.scope_id,
        grantedAt: row.granted_at,
        roleId: role.id,
        roleCode: role.code,
        roleName: role.name,
        permissions: normalizePermissions(role.permissions),
      } satisfies ScopedRoleAssignment
    })
    .filter((assignment): assignment is ScopedRoleAssignment => Boolean(assignment))
}

export function getOrgScopedAssignments(assignments: ScopedRoleAssignment[]): ScopedRoleAssignment[] {
  return assignments.filter((assignment) => assignment.scopeType === 'org')
}

export function getOrgRoleCodes(assignments: ScopedRoleAssignment[]): string[] {
  return Array.from(new Set(
    getOrgScopedAssignments(assignments).map((assignment) => assignment.roleCode)
  ))
}

export function getOrgPermissions(assignments: ScopedRoleAssignment[]): string[] {
  return Array.from(new Set(
    getOrgScopedAssignments(assignments).flatMap((assignment) => assignment.permissions)
  ))
}

export function canManageOrg(assignments: ScopedRoleAssignment[]): boolean {
  return canAccessOrgAdmin(getOrgPermissions(assignments), getOrgRoleCodes(assignments))
}

export async function listAccessibleSalesSpaces(userId: string, orgId: string): Promise<{
  assignments: ScopedRoleAssignment[]
  spaces: SalesSpaceSummary[]
}> {
  const [assignments, memberResult] = await Promise.all([
    getUserScopedRoleAssignments(userId),
    supabaseAdmin
      .from('sales_space_members')
      .select('space:sales_spaces(id, name, description, department_id, owner_id, active_opportunities, pending_milestones)')
      .eq('user_id', userId),
  ])

  if (memberResult.error) {
    throw memberResult.error
  }

  const memberSpaces = ((memberResult.data || []) as SalesSpaceMemberRow[])
    .map((row) => unwrapOne(row.space))
    .filter((space): space is SalesSpaceSummary => Boolean(space))

  if (canManageOrg(assignments)) {
    const { data, error } = await supabaseAdmin
      .from('sales_spaces')
      .select('id, name, description, department_id, owner_id, active_opportunities, pending_milestones')
      .eq('org_id', orgId)

    if (error) {
      throw error
    }

    return {
      assignments,
      spaces: mergeSpaces((data || []) as SalesSpaceSummary[], memberSpaces),
    }
  }

  const departmentScopeIds = uniqueStrings(
    assignments
      .filter((assignment) => assignment.scopeType === 'department')
      .map((assignment) => assignment.scopeId)
  )

  const directSpaceIds = uniqueStrings(
    assignments
      .filter((assignment) => assignment.scopeType === 'space')
      .map((assignment) => assignment.scopeId)
  )
  const expandedDepartmentScopeIds = await listDepartmentSubtreeIds(orgId, departmentScopeIds)

  const extraGroups: SalesSpaceSummary[][] = []

  if (expandedDepartmentScopeIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('sales_spaces')
      .select('id, name, description, department_id, owner_id, active_opportunities, pending_milestones')
      .eq('org_id', orgId)
      .in('department_id', expandedDepartmentScopeIds)

    if (error) {
      throw error
    }

    extraGroups.push((data || []) as SalesSpaceSummary[])
  }

  if (directSpaceIds.length > 0) {
    const { data, error } = await supabaseAdmin
      .from('sales_spaces')
      .select('id, name, description, department_id, owner_id, active_opportunities, pending_milestones')
      .eq('org_id', orgId)
      .in('id', directSpaceIds)

    if (error) {
      throw error
    }

    extraGroups.push((data || []) as SalesSpaceSummary[])
  }

  return {
    assignments,
    spaces: mergeSpaces(memberSpaces, ...extraGroups),
  }
}

export async function listAccessibleUserIds(userId: string, orgId?: string): Promise<{
  orgId: string
  assignments: ScopedRoleAssignment[]
  userIds: string[]
}> {
  const effectiveOrgId = orgId || await getDefaultOrgId(userId)
  const assignments = await getUserScopedRoleAssignments(userId)

  if (canManageOrg(assignments)) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('org_id', effectiveOrgId)

    if (error) {
      throw error
    }

    return {
      orgId: effectiveOrgId,
      assignments,
      userIds: uniqueStrings(((data || []) as UserSummaryRow[]).map((row) => row.id)),
    }
  }

  const userIds = new Set<string>([userId])
  const departmentScopeIds = uniqueStrings(
    assignments
      .filter((assignment) => assignment.scopeType === 'department')
      .map((assignment) => assignment.scopeId)
  )
  const expandedDepartmentIds = await listDepartmentSubtreeIds(effectiveOrgId, departmentScopeIds)
  const directSpaceIds = uniqueStrings(
    assignments
      .filter((assignment) => assignment.scopeType === 'space')
      .map((assignment) => assignment.scopeId)
  )

  if (expandedDepartmentIds.length > 0) {
    const [departmentUsersResult, primaryUsersResult] = await Promise.all([
      supabaseAdmin
        .from('user_departments')
        .select('user_id')
        .in('department_id', expandedDepartmentIds),
      supabaseAdmin
        .from('users')
        .select('id')
        .eq('org_id', effectiveOrgId)
        .in('primary_dept_id', expandedDepartmentIds),
    ])

    if (departmentUsersResult.error) {
      throw departmentUsersResult.error
    }
    if (primaryUsersResult.error) {
      throw primaryUsersResult.error
    }

    for (const member of (departmentUsersResult.data || []) as UserDepartmentMemberRow[]) {
      userIds.add(member.user_id)
    }
    for (const userRow of (primaryUsersResult.data || []) as UserSummaryRow[]) {
      userIds.add(userRow.id)
    }
  }

  const memberSpacesResult = await supabaseAdmin
    .from('sales_space_members')
    .select('space_id')
    .eq('user_id', userId)

  if (memberSpacesResult.error) {
    throw memberSpacesResult.error
  }

  const spaceIds = uniqueStrings([
    ...directSpaceIds,
    ...((memberSpacesResult.data || []) as Array<{ space_id: string | null }>).map((row) => row.space_id),
  ])

  if (spaceIds.length > 0) {
    const [spaceMembersResult, spaceOwnersResult] = await Promise.all([
      supabaseAdmin
        .from('sales_space_members')
        .select('user_id')
        .in('space_id', spaceIds),
      supabaseAdmin
        .from('sales_spaces')
        .select('owner_id')
        .eq('org_id', effectiveOrgId)
        .in('id', spaceIds),
    ])

    if (spaceMembersResult.error) {
      throw spaceMembersResult.error
    }
    if (spaceOwnersResult.error) {
      throw spaceOwnersResult.error
    }

    for (const member of (spaceMembersResult.data || []) as SalesSpaceMemberUserRow[]) {
      userIds.add(member.user_id)
    }
    for (const space of (spaceOwnersResult.data || []) as SalesSpaceOwnerRow[]) {
      if (space.owner_id) {
        userIds.add(space.owner_id)
      }
    }
  }

  return {
    orgId: effectiveOrgId,
    assignments,
    userIds: Array.from(userIds),
  }
}
