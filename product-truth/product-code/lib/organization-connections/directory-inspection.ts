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
type Employee = Pick<AdapterDirectoryRead['employees'][number], 'id' | 'name' | 'departmentIds' | 'primaryDepartmentId' | 'status'>

export type DirectoryInspection = {
  version: 'f003-directory-inspection-v1'
  binding: DirectoryInspectionBinding
  checkedAt: string
  contentHash: string
  observationHash: string
  readOnly: true
  applied: false
  departments: Department[]
  employees: Employee[]
  structure: { complete: boolean; issues: DirectoryInspectionIssue[] }
  scope: {
    verified: false
    status: 'independent_evidence_required'
    evidence: null
    reason: string
    requiredEvidence: string[]
  }
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
  const employees = directory.employees.map(({ id, name, departmentIds, primaryDepartmentId, status }) => ({
    id, name, departmentIds: [...departmentIds].sort(), primaryDepartmentId, status,
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
    if (!knownStatuses.has(employee.status)) add('unknown_status', 'employee', employee.id, '员工状态尚未识别。')
    if (!employee.departmentIds.length) add('missing_department', 'employee', employee.id, '员工没有部门关系。')
    if (employee.departmentIds.some(id => !departmentById.has(id))) add('department_not_read', 'employee', employee.id, '员工所属部门未出现在本次读取结果中。')
    if (new Set(employee.departmentIds).size !== employee.departmentIds.length) add('duplicate_department_relation', 'employee', employee.id, '员工部门关系重复。')
    if (!employee.primaryDepartmentId || !employee.departmentIds.includes(employee.primaryDepartmentId)) add('invalid_primary_department', 'employee', employee.id, '员工主属部门缺失或不属于其部门关系。')
  }
  if (!directory.complete) add('provider_snapshot_incomplete', 'directory', null, '提供方读取尚未通过完整性检查。')
  if (!Number.isFinite(Date.parse(directory.checkedAt))) add('invalid_observation_time', 'directory', null, '提供方读取时间无效。')
  const contentHash = digest({ provider: binding.provider, externalTenantId: binding.externalTenantId, departments, employees })
  return {
    version: 'f003-directory-inspection-v1',
    binding: { ...binding },
    checkedAt: directory.checkedAt,
    contentHash,
    observationHash: digest({ binding, checkedAt: directory.checkedAt, contentHash }),
    readOnly: true,
    applied: false,
    departments,
    employees,
    structure: { complete: issues.length === 0, issues },
    // Neither a provider's boolean nor a free-text assertion is independent
    // scope evidence. No supported authoritative evidence reader exists yet.
    scope: {
      verified: false,
      status: 'independent_evidence_required',
      evidence: null,
      reason: '当前结果仅覆盖此连接可读取的范围，尚缺独立的全公司目录依据，不能据此同步或切源。',
      requiredEvidence: [
        '同一企业的权威部门和员工清单，含稳定标识、部门关系与人员状态范围',
        '管理端读取权限和全公司范围依据，注明来源及取证时间',
        '按稳定标识逐项对账并解释差异；总数相同不能代替逐项核对',
      ],
    },
  }
}
