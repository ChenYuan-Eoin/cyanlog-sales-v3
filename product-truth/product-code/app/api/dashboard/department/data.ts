import type { DashboardPayload } from '@/lib/dashboard-data'
import { attachHistoricalSpaceIds, buildDepartmentOptions, resolveDepartmentSpaceIds, type DepartmentOption, type DepartmentSpace } from '@/lib/department-spaces'
import { hasPermission } from '@/lib/permissions'
import { isRetiredRoleCode, isRoleAssignableInScope, resolveRolePermissions } from '@/lib/role-permission-resolution'
import { supabaseAdmin } from '@/lib/supabase'
import { DEPARTMENT_AUTOMATIC_ROLE_READ_RPC, readDepartmentAutomaticRoleRows } from '@/lib/admin/department-automatic-role-read'

type ScopeType = 'org' | 'department' | 'space'
type Role = { id: string; code: string; permissions: unknown; owner_org_id: string | null }
type RoleAssignment = {
  user_id: string
  org_id: string
  scope_type: ScopeType
  scope_id: string | null
  role: Role | Role[] | null
}
type ActiveGrant = { scopeType: ScopeType; scopeId: string; code: string; permissions: string[] }
export type DepartmentSelection = { departmentId: string | null; includeSubdepartments: boolean }
type OpportunityRow = Omit<DashboardPayload['opportunities'][number], 'customer'>
type MilestoneRow = Omit<DashboardPayload['milestones'][number], 'opportunity'>
type CustomerRow = NonNullable<DashboardPayload['opportunities'][number]['customer']>
type DepartmentDashboardPayload = Pick<DashboardPayload, 'opportunities' | 'milestones'> & {
  organizationId: string
  departmentSpaces: DepartmentOption[]
  selection: DepartmentSelection
}

export class DepartmentAccessError extends Error {
  readonly code: 'DEPARTMENT_SCOPE_REQUIRED' | 'DEPARTMENT_SELECTION_FORBIDDEN' | 'DEPARTMENT_MEMBERSHIP_REQUIRED'
  constructor(departmentId: string | null, options: { membershipRequired?: true } = {}) {
    super(options.membershipRequired ? '没有有效的组织成员资格'
      : departmentId ? '无权查看所选部门' : '没有可用的部门授权')
    this.code = options.membershipRequired ? 'DEPARTMENT_MEMBERSHIP_REQUIRED'
      : departmentId ? 'DEPARTMENT_SELECTION_FORBIDDEN' : 'DEPARTMENT_SCOPE_REQUIRED'
  }
}

async function getCurrentOrg(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin.from('user_organizations')
    .select('org_id,status,employment_status,is_default,left_at')
    .eq('user_id', userId).eq('is_default', true).limit(2)
  if (error) throw error
  const membership = data?.length === 1 ? data[0] : undefined
  if (!membership?.org_id || membership.status !== 'active' || membership.employment_status !== 'active'
    || membership.is_default !== true || membership.left_at !== null) {
    throw new DepartmentAccessError(null, { membershipRequired: true })
  }
  return membership.org_id
}

async function getActiveOrganization(orgId: string) {
  const { data, error } = await supabaseAdmin.from('organizations').select('id,status,settings').eq('id', orgId).maybeSingle()
  if (error) throw error
  if (data?.id !== orgId || data.status !== 'active') {
    throw new DepartmentAccessError(null, { membershipRequired: true })
  }
  return data
}

export async function getPersonalDashboardOrg(userId: string): Promise<string> {
  const orgId = await getCurrentOrg(userId)
  await getActiveOrganization(orgId)
  return orgId
}

async function getCurrentGrants(userId: string, orgId: string): Promise<ActiveGrant[]> {
  const [activeOrganization, assignments] = await Promise.all([
    getActiveOrganization(orgId),
    supabaseAdmin.from('user_roles').select('user_id,org_id,scope_type,scope_id,role:roles(id,code,permissions,owner_org_id)')
      .eq('org_id', orgId).eq('user_id', userId),
  ])
  if (assignments.error) throw assignments.error

  return ((assignments.data ?? []) as RoleAssignment[]).flatMap((assignment) => {
    const role = Array.isArray(assignment.role)
      ? (assignment.role.length === 1 ? assignment.role[0] : null)
      : assignment.role
    if (!role?.id || !role.code || isRetiredRoleCode(role.code) || assignment.user_id !== userId || assignment.org_id !== orgId || !assignment.scope_id
      || (role.owner_org_id !== null && role.owner_org_id !== orgId)) return []
    if (assignment.scope_type === 'org' && assignment.scope_id !== orgId) return []
    if (role.code === 'SUPER_ADMIN' && role.owner_org_id !== null) return []
    if (assignment.scope_type !== 'org' && role.code === 'SUPER_ADMIN') return []
    if (!isRoleAssignableInScope(role.code, assignment.scope_type)) return []
    const { permissions } = resolveRolePermissions(activeOrganization.settings, role)
    return [{ scopeType: assignment.scope_type, scopeId: assignment.scope_id, code: role.code, permissions }]
  })
}

/** Reads only grants that belong to the actor's current active organization. */
export async function loadActiveOrganizationGrants(userId: string) {
  const orgId = await getCurrentOrg(userId)
  return { orgId, assignments: await getCurrentGrants(userId, orgId) }
}

async function getApprovedLeadDepartments(userId: string, orgId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin.from('department_lead_access').select('department_id')
    .eq('org_id', orgId).eq('user_id', userId)
  if (error) {
    // Existing role grants also work during rollout before the table is present.
    if (error.code === 'PGRST205' || error.code === '42P01') return new Set()
    throw error
  }
  return new Set((data ?? []).map(row => row.department_id))
}

function spacesForPermission(
  grants: ActiveGrant[],
  permission: 'opportunity:*' | 'opportunity:own',
  allDepartments: DepartmentOption[],
  selectedDepartments: DepartmentSpace[],
): string[] {
  const allowed = grants.filter(grant => grant.permissions.includes('*') || grant.permissions.includes(permission))
  const wholeOrganization = allowed.some(grant => grant.scopeType === 'org')
  const departmentRoots = allowed.filter(grant => grant.scopeType === 'department').map(grant => grant.scopeId)
  const departmentIds = resolveDepartmentSpaceIds(allDepartments, departmentRoots)
  const directSpaceIds = new Set(allowed.filter(grant => grant.scopeType === 'space').map(grant => grant.scopeId))

  return selectedDepartments.flatMap(department => {
    if (wholeOrganization || departmentIds.has(department.department_id)) return department.sales_space_ids
    return department.sales_space_ids.filter(spaceId => directSpaceIds.has(spaceId))
  })
}

const OPPORTUNITY_LIMIT = 20

async function loadOpportunities(orgId: string, spaceIds: string[], ownerId?: string): Promise<OpportunityRow[]> {
  if (spaceIds.length === 0) return []
  let query = supabaseAdmin.from('opportunities')
    .select('id,space_id,customer_id,name,amount,status,stage,probability,owner_id,expected_close_date')
    .eq('org_id', orgId).in('space_id', spaceIds)
  if (ownerId) query = query.eq('owner_id', ownerId)
  const { data, error } = await query
    .order('expected_close_date', { ascending: true, nullsFirst: false }).order('id', { ascending: true })
    .limit(OPPORTUNITY_LIMIT)
  if (error) throw error
  return (data ?? []) as OpportunityRow[]
}

async function getDashboardRows(
  userId: string,
  orgId: string,
  fullSpaceIds: string[],
  ownSpaceIds: string[],
): Promise<Pick<DepartmentDashboardPayload, 'opportunities' | 'milestones'>> {
  const [teamRows, personalRows] = await Promise.all([
    loadOpportunities(orgId, fullSpaceIds),
    loadOpportunities(orgId, ownSpaceIds, userId),
  ])
  const rows = [...teamRows, ...personalRows].sort((left, right) => {
    const order = (left.expected_close_date ?? '9999-12-31').localeCompare(right.expected_close_date ?? '9999-12-31')
    return order || left.id.localeCompare(right.id)
  }).slice(0, OPPORTUNITY_LIMIT)
  if (rows.length === 0) return { opportunities: [], milestones: [] }

  const customerIds = [...new Set(rows.map(row => row.customer_id))]
  const customers = await supabaseAdmin.from('customers').select('id,name,short_name').eq('org_id', orgId).in('id', customerIds)
  if (customers.error) throw customers.error
  const customerById = new Map(((customers.data ?? []) as CustomerRow[]).map(customer => [customer.id, customer]))
  const opportunities = rows.flatMap((row) => {
    const customer = customerById.get(row.customer_id)
    return customer ? [{ ...row, customer }] : []
  })
  if (opportunities.length === 0) return { opportunities, milestones: [] }

  const opportunityById = new Map(opportunities.map(row => [row.id, row]))
  const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const milestones = await supabaseAdmin.from('milestones').select('id,opportunity_id,name,type,status,priority,due_date')
    .eq('org_id', orgId).in('opportunity_id', [...opportunityById.keys()])
    .in('status', ['PENDING', 'IN_PROGRESS']).lte('due_date', nextWeek).order('due_date', { ascending: true }).limit(10)
  if (milestones.error) throw milestones.error
  return {
    opportunities,
    milestones: ((milestones.data ?? []) as MilestoneRow[]).flatMap(row => {
      const opportunity = opportunityById.get(row.opportunity_id)
      return opportunity ? [{ ...row, opportunity: { name: opportunity.name, customer_id: opportunity.customer_id } }] : []
    }),
  }
}

export async function getDepartmentDashboardScope(userId: string, selection: DepartmentSelection) {
  const orgId = await getCurrentOrg(userId)
  const [grants, automaticRoles] = await Promise.all([
    getCurrentGrants(userId, orgId),
    supabaseAdmin.rpc(DEPARTMENT_AUTOMATIC_ROLE_READ_RPC, { p_org_id: orgId, p_user_id: userId }),
  ])
  if (automaticRoles.error && automaticRoles.error.code !== 'PGRST202') throw automaticRoles.error
  const organizationGrants = grants.filter(grant => grant.scopeType === 'org'
    && hasPermission(grant.permissions, 'role:manage'))
  const allDepartmentsVisible = organizationGrants.some(grant => grant.code === 'SUPER_ADMIN')
  const departmentRoots = [
    ...grants.filter(grant => grant.scopeType === 'department'
      && (grant.permissions.includes('dept:view') || grant.permissions.includes('report:dept')))
      .map(grant => grant.scopeId),
    ...readDepartmentAutomaticRoleRows(automaticRoles.data ?? [])
      .filter(grant => grant.permissions.includes('dept:view') || grant.permissions.includes('report:dept'))
      .map(grant => grant.departmentId),
  ]
  const approvedLeadDepartments = allDepartmentsVisible ? new Set<string>() : await getApprovedLeadDepartments(userId, orgId)
  if (!allDepartmentsVisible && departmentRoots.length === 0 && approvedLeadDepartments.size === 0) {
    throw new DepartmentAccessError(selection.departmentId)
  }

  const departments = await supabaseAdmin.from('departments').select('id,name,parent_id,status,leader_id')
    .eq('org_id', orgId).eq('status', 'active').order('sort_order', { ascending: true }).order('id', { ascending: true })
  if (departments.error) throw departments.error
  const departmentRows = departments.data ?? []
  const allDepartments = buildDepartmentOptions(departmentRows)
  const roots = allDepartmentsVisible
    ? allDepartments.map(department => department.department_id)
    : [
        ...departmentRoots,
        ...departmentRows.filter(department => (
          department.leader_id === userId && approvedLeadDepartments.has(department.id)
        )).map(department => department.id),
      ]
  const visibleIds = resolveDepartmentSpaceIds(allDepartments, roots)
  if (selection.departmentId && !visibleIds.has(selection.departmentId)) throw new DepartmentAccessError(selection.departmentId)
  if (visibleIds.size === 0 && !allDepartmentsVisible) throw new DepartmentAccessError(null)

  const departmentSpaces = allDepartments.filter(department => visibleIds.has(department.department_id)).map(department => ({
    ...department,
    parent_department_id: department.parent_department_id && visibleIds.has(department.parent_department_id)
      ? department.parent_department_id : null,
  }))
  const selectedDepartmentIds = selection.departmentId
    ? resolveDepartmentSpaceIds(departmentSpaces, roots, { ...selection, departmentId: selection.departmentId })
    : visibleIds
  return { orgId, departmentSpaces, selection, selectedDepartmentIds, allDepartments, grants }
}

export async function getDepartmentDashboard(userId: string, requestedSelection: DepartmentSelection): Promise<DepartmentDashboardPayload> {
  const { orgId, departmentSpaces, selection, selectedDepartmentIds, allDepartments, grants } =
    await getDepartmentDashboardScope(userId, requestedSelection)
  const overview = { organizationId: orgId, departmentSpaces, selection }
  const canReadOpportunities = grants.some(grant => grant.permissions.some(
    permission => permission === '*' || permission === 'opportunity:*' || permission === 'opportunity:own',
  ))
  if (selectedDepartmentIds.size === 0 || !canReadOpportunities) {
    return { ...overview, opportunities: [], milestones: [] }
  }

  // Existing opportunities have a historical foreign key. It contributes no
  // departments or authority, and is resolved only after the department check.
  const historical = await supabaseAdmin.from('sales_spaces').select('id,department_id').eq('org_id', orgId).eq('status', 'active')
  if (historical.error) throw historical.error
  const selectedOptions = departmentSpaces.filter(department => selectedDepartmentIds.has(department.department_id))
  const selectedDepartments = attachHistoricalSpaceIds(selectedOptions, historical.data ?? [])
  const fullSpaces = new Set(spacesForPermission(grants, 'opportunity:*', allDepartments, selectedDepartments))
  const ownSpaceIds = spacesForPermission(grants, 'opportunity:own', allDepartments, selectedDepartments)
    .filter(spaceId => !fullSpaces.has(spaceId))
  const rows = await getDashboardRows(userId, orgId, [...fullSpaces], ownSpaceIds)
  return { ...overview, ...rows }
}
