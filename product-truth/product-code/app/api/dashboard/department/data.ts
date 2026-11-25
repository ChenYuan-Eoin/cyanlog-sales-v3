import { DashboardDataError, type DashboardPayload } from '@/lib/dashboard-data'
import { buildDepartmentSpaces, resolveDepartmentSpaceIds, type DepartmentSpace } from '@/lib/department-spaces'
import { hasPermission } from '@/lib/permissions'
import { ORG_SUPER_ADMIN_ROLE_CODE, resolveRolePermissions } from '@/lib/role-permission-resolution'
import { supabaseAdmin } from '@/lib/supabase'

type ScopeType = 'org' | 'department' | 'space'
type Role = { id: string; code: string; permissions: unknown }
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
  departmentSpaces: DepartmentSpace[]
  selection: DepartmentSelection
}

export class DepartmentAccessError extends Error {
  readonly code: 'DEPARTMENT_SCOPE_REQUIRED' | 'DEPARTMENT_SELECTION_FORBIDDEN' | 'DEPARTMENT_MEMBERSHIP_REQUIRED'
  readonly orgId: string | null

  constructor(departmentId: string | null, options: { orgId?: string; membershipRequired?: true } = {}) {
    super(options.membershipRequired ? '没有有效的组织成员资格'
      : departmentId ? '无权查看所选部门空间' : '没有可用的部门空间授权')
    this.code = options.membershipRequired ? 'DEPARTMENT_MEMBERSHIP_REQUIRED'
      : departmentId ? 'DEPARTMENT_SELECTION_FORBIDDEN' : 'DEPARTMENT_SCOPE_REQUIRED'
    this.orgId = this.code === 'DEPARTMENT_SCOPE_REQUIRED' ? options.orgId ?? null : null
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
    supabaseAdmin.from('user_roles').select('user_id,org_id,scope_type,scope_id,role:roles(id,code,permissions)')
      .eq('org_id', orgId).eq('user_id', userId),
  ])
  if (assignments.error) throw assignments.error

  return ((assignments.data ?? []) as RoleAssignment[]).flatMap((assignment) => {
    const role = Array.isArray(assignment.role)
      ? (assignment.role.length === 1 ? assignment.role[0] : null)
      : assignment.role
    if (!role?.id || !role.code || assignment.user_id !== userId || assignment.org_id !== orgId || !assignment.scope_id) return []
    if (assignment.scope_type === 'org' && assignment.scope_id !== orgId) return []
    if (assignment.scope_type !== 'org' && (role.code === 'SUPER_ADMIN' || role.code === ORG_SUPER_ADMIN_ROLE_CODE)) return []
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
  allDepartments: DepartmentSpace[],
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
  const grants = await getCurrentGrants(userId, orgId)
  const organizationGrants = grants.filter(grant => grant.scopeType === 'org'
    && hasPermission(grant.permissions, 'role:manage'))
  const orgOversight = organizationGrants.some(grant => grant.code === ORG_SUPER_ADMIN_ROLE_CODE)
  const allDepartmentsVisible = orgOversight || organizationGrants.some(grant => grant.code === 'SUPER_ADMIN')
  const departmentGrants = grants.filter(grant => grant.scopeType === 'department'
    && (grant.permissions.includes('dept:view') || grant.permissions.includes('report:dept')))
  const approvedLeadDepartments = allDepartmentsVisible ? new Set<string>() : await getApprovedLeadDepartments(userId, orgId)
  if (!allDepartmentsVisible && departmentGrants.length === 0 && approvedLeadDepartments.size === 0) {
    throw new DepartmentAccessError(selection.departmentId, { orgId })
  }

  const [departments, spaces] = await Promise.all([
    supabaseAdmin.from('departments').select('id,name,parent_id,status,leader_id').eq('org_id', orgId).eq('status', 'active')
      .order('sort_order', { ascending: true }).order('id', { ascending: true }),
    supabaseAdmin.from('sales_spaces').select('id,department_id').eq('org_id', orgId).eq('status', 'active'),
  ])
  if (departments.error) throw departments.error
  if (spaces.error) throw spaces.error
  const departmentRows = departments.data ?? []
  const allDepartments = buildDepartmentSpaces(departmentRows, spaces.data ?? [])
  const roots = allDepartmentsVisible
    ? allDepartments.map(department => department.department_id)
    : [
        ...departmentGrants.map(grant => grant.scopeId),
        ...departmentRows.filter(department => (
          department.leader_id === userId && approvedLeadDepartments.has(department.id)
        )).map(department => department.id),
      ]
  const visibleIds = resolveDepartmentSpaceIds(allDepartments, roots)
  if (selection.departmentId && !visibleIds.has(selection.departmentId)) throw new DepartmentAccessError(selection.departmentId)
  if (visibleIds.size === 0 && !allDepartmentsVisible && departmentGrants.length === 0) {
    throw new DepartmentAccessError(null, { orgId })
  }

  const departmentSpaces = allDepartments.filter(department => visibleIds.has(department.department_id)).map(department => ({
    ...department,
    parent_department_id: department.parent_department_id && visibleIds.has(department.parent_department_id)
      ? department.parent_department_id : null,
  }))
  const selectedIds = selection.departmentId
    ? resolveDepartmentSpaceIds(departmentSpaces, roots, { ...selection, departmentId: selection.departmentId })
    : visibleIds
  const selectedDepartments = departmentSpaces.filter(department => selectedIds.has(department.department_id))
  // Organization management includes this workbench's selected-department overview.
  const fullSpaces = new Set(orgOversight
    ? selectedDepartments.flatMap(department => department.sales_space_ids)
    : spacesForPermission(grants, 'opportunity:*', allDepartments, selectedDepartments))
  const ownSpaceIds = spacesForPermission(grants, 'opportunity:own', allDepartments, selectedDepartments)
    .filter(spaceId => !fullSpaces.has(spaceId))
  return { orgId, departmentSpaces, selection, fullSpaceIds: [...fullSpaces], ownSpaceIds }
}

export async function getDepartmentDashboard(userId: string, requestedSelection: DepartmentSelection): Promise<DepartmentDashboardPayload> {
  const { orgId, departmentSpaces, selection, fullSpaceIds, ownSpaceIds } = await getDepartmentDashboardScope(userId, requestedSelection)
  const rows = await getDashboardRows(userId, orgId, fullSpaceIds, ownSpaceIds)
  return { departmentSpaces, selection, ...rows }
}

export async function getDepartmentLegacyWorkspace(userId: string, requestedSpaceId: string | null) {
  const { orgId, fullSpaceIds, ownSpaceIds } = await getDepartmentDashboardScope(userId, {
    departmentId: null, includeSubdepartments: true,
  })
  const spaceIds = [...fullSpaceIds, ...ownSpaceIds]
  const spaceForbidden = () => new DashboardDataError('无权查看所选销售空间', 'DASHBOARD_SPACE_FORBIDDEN', 403)
  if (requestedSpaceId !== null && !spaceIds.includes(requestedSpaceId)) throw spaceForbidden()
  if (spaceIds.length === 0) {
    return { orgId, spaces: [], activeSpace: null, opportunities: [], milestones: [] }
  }

  const { data, error } = await supabaseAdmin.from('sales_spaces').select('id,name,description,department_id,owner_id')
    .eq('org_id', orgId).eq('status', 'active').in('id', spaceIds)
    .order('name', { ascending: true }).order('id', { ascending: true })
  if (error) throw error
  const spaces = (data ?? []).map(space => ({ ...space, active_opportunities: null, pending_milestones: null }))
  const activeSpace = requestedSpaceId === null ? spaces[0] ?? null : spaces.find(space => space.id === requestedSpaceId)
  if (requestedSpaceId !== null && !activeSpace) throw spaceForbidden()
  const teamSpaces = activeSpace && fullSpaceIds.includes(activeSpace.id) ? [activeSpace.id] : []
  const personalSpaces = activeSpace && ownSpaceIds.includes(activeSpace.id) ? [activeSpace.id] : []
  const rows = await getDashboardRows(userId, orgId, teamSpaces, personalSpaces)

  return { orgId, spaces, activeSpace: activeSpace ?? null, ...rows }
}
