import type { MiddlewareRestClient } from '@/lib/middleware-rest-client'
import { isRetiredRoleCode, resolveRolePermissions } from '@/lib/role-permission-resolution'

export const DEPARTMENT_LEDGER_VIEW = 'shipping:ledger_view'
const LEDGER_ITEM_PATH = /^\/api\/shipping\/ledger\/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const MAX_SCOPE_ROWS = 1_000

export function isDepartmentLedgerReadPath(path: string) {
  return path === '/api/shipping/ledger' || LEDGER_ITEM_PATH.test(path)
}

export function isDepartmentLedgerReturnPath(path: string) {
  return path.endsWith('/return') && LEDGER_ITEM_PATH.test(path.slice(0, -'/return'.length))
}

export type LedgerDepartment = { id: string; name: string; parentId: string | null }
type DepartmentRow = { id: string; org_id: string; name: string; parent_id: string | null; status: string }
type SubjectRow = { org_id: string; user_id: string; department_id: string }
type LeadRow = SubjectRow & { department: { id: string; org_id: string; leader_id: string; status: string } | null }
type RoleRow = {
  org_id: string; user_id: string; scope_type: string; scope_id: string
  roles: { id: string; code: string; permissions: unknown; owner_org_id: string | null } | null
}
type ScopeRoot = { id: string; descendants: boolean }

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function explicitRoots(settings: unknown) {
  const grants = object(object(settings)?.department_permission_grants)
  if (!grants) return new Map<string, ScopeRoot>()
  return new Map(Object.entries(grants).flatMap(([id, value]) => {
    const grant = object(value)
    return typeof grant?.include_subdepartments === 'boolean'
      && Array.isArray(grant.permissions) && grant.permissions.length === 1 && grant.permissions[0] === DEPARTMENT_LEDGER_VIEW
      ? [[id, { id, descendants: grant.include_subdepartments }] as const] : []
  }))
}

function descendants(options: readonly LedgerDepartment[], rootIds: readonly string[]) {
  const active = new Set(options.map(department => department.id))
  const children = new Map<string, string[]>()
  for (const department of options) {
    if (department.parentId) children.set(department.parentId, [...(children.get(department.parentId) ?? []), department.id])
  }
  const found = new Set<string>()
  const pending = [...rootIds]
  while (pending.length) {
    const id = pending.pop()!
    if (!active.has(id) || found.has(id)) continue
    found.add(id)
    pending.push(...(children.get(id) ?? []))
  }
  return found
}

async function activeTree(rest: MiddlewareRestClient, orgId: string) {
  const rows = await rest.selectRows<DepartmentRow>('departments', { org_id: orgId, status: 'active' },
    'id,org_id,name,parent_id,status', MAX_SCOPE_ROWS)
  if (rows.length >= MAX_SCOPE_ROWS) throw new Error('Shipping department scope exceeds the verified query limit')
  return rows.filter(row => row.org_id === orgId && row.status === 'active')
    .map(row => ({ id: row.id, name: row.name, parentId: row.parent_id }))
}

export async function loadAuthorizedLedgerDepartments(rest: MiddlewareRestClient, orgId: string, departmentIds?: string[]) {
  if (departmentIds?.length === 0) return []
  const options = await activeTree(rest, orgId)
  return departmentIds ? filterLedgerDepartments(options, new Set(departmentIds)) : options
}

export async function loadDepartmentLedgerScope(
  rest: MiddlewareRestClient, orgId: string, userId: string, settings: unknown, organizationWide = false,
): Promise<LedgerDepartment[]> {
  if (organizationWide) return activeTree(rest, orgId)
  const grants = explicitRoots(settings)
  const subject = { org_id: orgId, user_id: userId }
  const [roles, memberships, leads] = await Promise.all([
    rest.selectRows<RoleRow>('user_roles', { ...subject, scope_type: 'department' },
      'org_id,user_id,scope_type,scope_id,roles:roles(id,code,permissions,owner_org_id)', MAX_SCOPE_ROWS),
    grants.size ? rest.selectRows<SubjectRow>('user_departments', subject, 'org_id,user_id,department_id', MAX_SCOPE_ROWS) : [],
    grants.size ? rest.selectRows<LeadRow>('department_lead_access', {
      ...subject, 'department.org_id': orgId, 'department.status': 'active', 'department.leader_id': userId,
    }, 'org_id,user_id,department_id,department:departments!department_lead_access_department_id_fkey!inner(id,org_id,status,leader_id)', MAX_SCOPE_ROWS) : [],
  ])
  if ([roles, memberships, leads].some(rows => rows.length >= MAX_SCOPE_ROWS)) {
    throw new Error('Shipping department scope exceeds the verified query limit')
  }

  const roots = [...memberships, ...leads.filter(({ department, department_id }) =>
    department?.id === department_id && department.org_id === orgId && department.status === 'active' && department.leader_id === userId,
  )].flatMap(row => row.org_id === orgId && row.user_id === userId ? [grants.get(row.department_id)] : [])
    .filter((root): root is ScopeRoot => root !== undefined)

  for (const row of roles) {
    const role = row.roles
    if (row.org_id !== orgId || row.user_id !== userId || row.scope_type !== 'department' || !role?.id
      || (role.owner_org_id !== null && role.owner_org_id !== orgId)
      || !role.code || role.code === 'SUPER_ADMIN' || isRetiredRoleCode(role.code)) continue
    if (resolveRolePermissions(settings, role).permissions.includes(DEPARTMENT_LEDGER_VIEW)) {
      roots.push({ id: row.scope_id, descendants: true })
    }
  }
  if (!roots.length) return []
  const options = await activeTree(rest, orgId)
  const allowed = new Set(roots.filter(root => !root.descendants).map(root => root.id))
  for (const id of descendants(options, roots.filter(root => root.descendants).map(root => root.id))) allowed.add(id)
  return filterLedgerDepartments(options, allowed)
}

function filterLedgerDepartments(options: readonly LedgerDepartment[], allowed: ReadonlySet<string>): LedgerDepartment[] {
  const activeById = new Map(options.map(option => [option.id, option]))
  return options.filter(option => allowed.has(option.id)).map(option => {
    // Keep ancestry between visible options even when intermediate departments are hidden.
    const visited = new Set([option.id])
    let parentId = option.parentId
    while (parentId && activeById.has(parentId) && !visited.has(parentId)) {
      if (allowed.has(parentId)) return { ...option, parentId }
      visited.add(parentId)
      parentId = activeById.get(parentId)?.parentId ?? null
    }
    return { ...option, parentId: null }
  })
}

/** The selector can only narrow the already-authorized set. */
export function selectLedgerDepartments(options: readonly LedgerDepartment[], departmentId?: string, includeSubdepartments = false) {
  if (!departmentId) return options.map(option => option.id)
  if (!options.some(option => option.id === departmentId)) return null
  return includeSubdepartments ? [...descendants(options, [departmentId])] : [departmentId]
}
