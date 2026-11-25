type Department = {
  id: string
  name: string
  parent_id?: string | null
  status?: string | null
}

type SalesSpace = {
  id: string
  department_id: string | null
}

export type DepartmentSpace = {
  department_id: string
  parent_department_id: string | null
  name: string
  sales_space_ids: string[]
}

export function buildDepartmentSpaces(departments: Department[], salesSpaces: SalesSpace[]): DepartmentSpace[] {
  const activeDepartments = departments.filter(department => !department.status || department.status === 'active')
  const departmentIds = new Set(activeDepartments.map(department => department.id))
  const salesSpaceIds = new Map<string, string[]>()

  for (const space of salesSpaces) {
    if (!space.department_id || !departmentIds.has(space.department_id)) continue
    const ids = salesSpaceIds.get(space.department_id) ?? []
    ids.push(space.id)
    salesSpaceIds.set(space.department_id, ids)
  }

  return activeDepartments.map(department => ({
    department_id: department.id,
    parent_department_id: department.parent_id && departmentIds.has(department.parent_id) ? department.parent_id : null,
    name: department.name,
    sales_space_ids: salesSpaceIds.get(department.id) ?? [],
  }))
}

type DepartmentSelection = { departmentId: string; includeSubdepartments: boolean }

export function resolveDepartmentSpaceIds(
  spaces: DepartmentSpace[],
  authorizedRootIds: readonly string[],
  selection?: DepartmentSelection,
): Set<string> {
  const departmentIds = new Set(spaces.map(space => space.department_id))
  const childrenByParent = new Map<string, string[]>()
  for (const space of spaces) {
    if (!space.parent_department_id) continue
    const children = childrenByParent.get(space.parent_department_id) ?? []
    children.push(space.department_id)
    childrenByParent.set(space.parent_department_id, children)
  }

  const descendants = (roots: readonly string[]) => {
    const pending = [...roots]
    const ids = new Set<string>()
    for (const id of pending) {
      if (!departmentIds.has(id) || ids.has(id)) continue
      ids.add(id)
      pending.push(...(childrenByParent.get(id) ?? []))
    }
    return ids
  }

  const authorizedIds = descendants(authorizedRootIds)
  if (!selection) return authorizedIds
  if (!authorizedIds.has(selection.departmentId)) return new Set()
  if (!selection.includeSubdepartments) return new Set([selection.departmentId])

  return descendants([selection.departmentId])
}
