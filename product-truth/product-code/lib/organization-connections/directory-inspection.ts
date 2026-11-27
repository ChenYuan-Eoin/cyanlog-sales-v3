// F003 / WP51. Immutable, read-only observations; never a cutover authorization.
import { createHash } from 'node:crypto'
import type { AdapterDirectoryRead, ConnectionState, OrganizationConnectionProvider } from './types'

export type DirectoryInspectionBinding = {
  organizationId: string
  sourceId: string
  provider: OrganizationConnectionProvider
  externalTenantId: string
  connectionRevision: string
  sourceState: ConnectionState
}

export type DirectoryInspectionIssue = {
  code: string
  entity: 'directory' | 'department' | 'employee'
  externalId: string | null
  message: string
}

type Department = AdapterDirectoryRead['departments'][number]
type Employee = Pick<AdapterDirectoryRead['employees'][number], 'id' | 'name' | 'departmentIds' | 'primaryDepartmentId' | 'status' | 'sourceConflict'>

export type DirectoryInspection = {
  version: 'f003-directory-inspection-v2'
  binding: DirectoryInspectionBinding
  checkedAt: string
  contentHash: string
  observationHash: string
  readOnly: true
  applied: false
  departments: Department[]
  employees: Employee[]
  structure: { complete: boolean; issues: DirectoryInspectionIssue[] }
  dataStatus: 'present' | 'empty'
}

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function buildDirectoryInspection(
  binding: DirectoryInspectionBinding,
  directory: AdapterDirectoryRead,
): DirectoryInspection {
  // Deliberately exclude phone/email and authentication fields from the directory
  // report. Ordering must not change its stable digest; duplicate references
  // remain visible as invalid input rather than being silently repaired.
  const byId = <T extends { id: string }>(a: T, b: T) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  const departments = directory.departments.map(({ id, name, parentId, status }) => ({ id, name, parentId, status })).sort(byId)
  const employees = directory.employees.map(({ id, name, departmentIds, primaryDepartmentId, status, sourceConflict }) => ({
    id, name, departmentIds: [...departmentIds].sort(), primaryDepartmentId, status,
    ...(sourceConflict ? { sourceConflict } : {}),
  })).sort(byId)
  const issues: DirectoryInspectionIssue[] = []
  const add = (code: string, entity: DirectoryInspectionIssue['entity'], externalId: string | null, message: string) => {
    issues.push({ code, entity, externalId, message })
  }
  const knownStatuses = new Set(['active', 'inactive', 'deleted'])
  const departmentById = new Map<string, Department>()
  for (const department of departments) {
    if (!department.id || departmentById.has(department.id)) add('duplicate_or_empty_id', 'department', department.id, '部门标识为空或重复。')
    departmentById.set(department.id, department)
    if (!knownStatuses.has(department.status)) add('unknown_status', 'department', department.id, '部门状态尚未识别。')
  }
  const resolved = new Set<string>()
  for (const department of departments) {
    if (department.parentId && !departmentById.has(department.parentId)) add('missing_parent', 'department', department.id, '上级部门未出现在本次读取结果中。')
    const visiting = new Set<string>()
    let cursor: string | null = department.id
    while (cursor && departmentById.has(cursor) && !resolved.has(cursor)) {
      if (visiting.has(cursor)) {
        add('department_cycle', 'department', cursor, '部门父子关系存在循环。')
        break
      }
      visiting.add(cursor)
      cursor = departmentById.get(cursor)!.parentId
    }
    visiting.forEach(id => resolved.add(id))
  }
  const employeeIds = new Set<string>()
  for (const employee of employees) {
    if (!employee.id || employeeIds.has(employee.id)) add('duplicate_or_empty_id', 'employee', employee.id, '员工标识为空或重复。')
    employeeIds.add(employee.id)
    if (employee.departmentIds.some(id => !departmentById.has(id))) add('department_not_read', 'employee', employee.id, '员工所属部门未出现在本次读取结果中。')
    if (new Set(employee.departmentIds).size !== employee.departmentIds.length) add('duplicate_department_relation', 'employee', employee.id, '员工部门关系重复。')
    if (employee.sourceConflict) {
      add('employee_source_conflict', 'employee', employee.id, '该员工的纷享记录需要核对。')
      continue
    }
    if (!knownStatuses.has(employee.status)) add('unknown_status', 'employee', employee.id, '员工状态尚未识别。')
    if (!employee.departmentIds.length) add('missing_department', 'employee', employee.id, '员工没有部门关系。')
    if (!employee.primaryDepartmentId || !employee.departmentIds.includes(employee.primaryDepartmentId)) add('invalid_primary_department', 'employee', employee.id, '员工主属部门缺失或不属于其部门关系。')
  }
  if (!directory.complete) add('provider_snapshot_incomplete', 'directory', null, '提供方读取尚未通过完整性检查。')
  if (!Number.isFinite(Date.parse(directory.checkedAt))) add('invalid_observation_time', 'directory', null, '提供方读取时间无效。')
  const contentHash = digest({ provider: binding.provider, externalTenantId: binding.externalTenantId, departments, employees })
  return {
    version: 'f003-directory-inspection-v2',
    binding: { ...binding },
    checkedAt: directory.checkedAt,
    contentHash,
    observationHash: digest({ binding, checkedAt: directory.checkedAt, contentHash }),
    readOnly: true,
    applied: false,
    departments,
    employees,
    structure: { complete: issues.every(issue => issue.code === 'employee_source_conflict'), issues },
    // IN-20261105-001: functional readback, with no manual roster/export gate.
    // This observation does not grant directory write or cutover authority.
    dataStatus: departments.length || employees.length ? 'present' : 'empty',
  }
}
