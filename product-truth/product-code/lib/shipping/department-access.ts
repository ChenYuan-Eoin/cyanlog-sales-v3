import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { effectiveShippingDepartmentIds, type IntakeRules } from './intake-rules'
import { loadFxiaokeSenderChoices } from './contacts'
import type { AuthUser } from '@/lib/auth'

export type ShippingDepartment = { id: string; name: string; parentId: string | null; path: string }
export type EmployeeShippingDepartment = ShippingDepartment & { isPrimary: boolean }
type DepartmentRow = { id: string; name: string; parent_id: string | null; status: string }

export function activeShippingDepartments(rows: DepartmentRow[]): ShippingDepartment[] {
  const active = new Map(rows.filter(row => row.status === 'active').map(row => [row.id, row]))
  const pathFor = (id: string, visiting = new Set<string>()): string => {
    const row = active.get(id)
    if (!row) return ''
    if (visiting.has(id)) throw new ShippingError(503, '组织部门层级异常，请联系管理员。')
    visiting.add(id)
    const parent = row.parent_id ? pathFor(row.parent_id, visiting) : ''
    visiting.delete(id)
    return parent ? `${parent} / ${row.name}` : row.name
  }
  return [...active.values()].map(row => ({ id: row.id, name: row.name, parentId: row.parent_id, path: pathFor(row.id) }))
    .sort((a, b) => a.path.localeCompare(b.path, 'zh-CN'))
}

async function loadShippingDepartmentRows(orgId: string): Promise<DepartmentRow[]> {
  const { data, error } = await supabaseAdmin.from('departments')
    .select('id,name,parent_id,status').eq('org_id', orgId).order('id').limit(1000)
  if (error || !data || data.length === 1000) throw new ShippingError(503, '组织部门暂不可用，请稍后重试。')
  return data as DepartmentRow[]
}

export async function loadShippingDepartments(orgId: string): Promise<ShippingDepartment[]> {
  return activeShippingDepartments(await loadShippingDepartmentRows(orgId))
}

export async function loadEmployeeShippingDepartments(userId: string, orgId: string, rules: IntakeRules): Promise<EmployeeShippingDepartment[]> {
  const [departmentRows, membership, assignments] = await Promise.all([
    loadShippingDepartmentRows(orgId),
    supabaseAdmin.from('user_organizations').select('status,employment_status').eq('org_id', orgId).eq('user_id', userId).maybeSingle(),
    supabaseAdmin.from('user_departments').select('department_id,is_primary').eq('org_id', orgId).eq('user_id', userId).limit(1000),
  ])
  if (membership.error || assignments.error || !assignments.data) throw new ShippingError(503, '员工部门归属暂不可用，请稍后重试。')
  if (membership.data?.status !== 'active' || membership.data?.employment_status !== 'active') {
    throw new ShippingError(403, '当前员工已停用，不能提报寄件工单。')
  }
  if (assignments.data.length === 1000) throw new ShippingError(503, '员工部门归属不完整，请联系管理员。')
  const departments = activeShippingDepartments(departmentRows)
  const allowed = effectiveShippingDepartmentIds(departments, rules.allowedDepartmentIds)
  const byId = new Map(departments.map(item => [item.id, item]))
  const ownDepartments = new Map(assignments.data.flatMap(item => {
    const department = byId.get(item.department_id)
    return department ? [[department.id, { ...department, isPrimary: item.is_primary === true }] as const] : []
  }))
  const assignedAncestors = new Set<string>()
  const hierarchy = new Map(departmentRows.map(item => [item.id, item.parent_id]))
  for (const assignment of assignments.data) {
    let parentId = hierarchy.get(assignment.department_id)
    const visited = new Set<string>()
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId)
      assignedAncestors.add(parentId)
      parentId = hierarchy.get(parentId) || null
    }
  }
  return [...ownDepartments.values()]
    .filter(department => !assignedAncestors.has(department.id) && allowed.has(department.id))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.path.localeCompare(b.path, 'zh-CN'))
}

export function resolveEmployeeShippingDepartment(departments: EmployeeShippingDepartment[], departmentId: string | undefined, oldTeamName?: string): EmployeeShippingDepartment {
  const exact = departmentId ? departments.find(item => item.id === departmentId) : undefined
  if (exact) return exact
  if (!departmentId && oldTeamName) {
    const matches = departments.filter(item => item.name === oldTeamName || item.path === oldTeamName)
    if (matches.length === 1) return matches[0]
  }
  throw new ShippingError(403, '所属部门未开放提报或归属已变化，请刷新页面后重选。')
}

export async function loadFxiaokeShippingProfile(user: AuthUser, orgId: string, rules: IntakeRules) {
  const [profile, departments] = await Promise.all([
    loadFxiaokeSenderChoices(user, orgId),
    loadEmployeeShippingDepartments(user.id, orgId, rules),
  ])
  const saved = departments.find(item => item.id === profile.departmentId)
  const byName = departments.filter(item => item.name === profile.team || item.path === profile.team)
  const selected = saved || (byName.length === 1 ? byName[0] : undefined) || departments[0]
  return { ...profile, departments, departmentId: selected?.id || '', team: selected?.name || '' }
}

export async function validateShippingDepartmentRoots(orgId: string, roots: string[] | null | undefined) {
  if (roots == null) return
  if (new Set(roots).size !== roots.length) throw new ShippingError(400, '寄件部门不能重复选择。')
  const active = new Set((await loadShippingDepartments(orgId)).map(item => item.id))
  if (roots.some(id => !active.has(id))) throw new ShippingError(400, '所选部门不存在、已停用或不属于当前组织。')
}
