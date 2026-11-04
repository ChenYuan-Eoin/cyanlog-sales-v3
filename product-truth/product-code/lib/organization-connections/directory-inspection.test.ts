// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildDirectoryInspection, type DirectoryInspectionBinding } from './directory-inspection'
import type { AdapterDirectoryRead } from './types'

const binding: DirectoryInspectionBinding = {
  organizationId: 'org-1', sourceId: 'source-1', provider: 'fxiaoke',
  externalTenantId: 'tenant-1', connectionRevision: 'revision-1', sourceState: 'disabled',
}
function directory(): AdapterDirectoryRead {
  return {
    checkedAt: '2026-11-04T10:00:00.000Z', complete: true, scopeVerified: false, scopeEvidence: null, warnings: [],
    departments: [
      { id: 'root', name: '公司', parentId: null, status: 'active' },
      { id: 'sales', name: '销售', parentId: 'root', status: 'active' },
    ],
    employees: [{ id: 'person-1', name: '员工甲', departmentIds: ['sales', 'root'], primaryDepartmentId: 'sales', status: 'active', loginDisabled: false, phone: 'private-phone', email: 'private-email', employeeNumber: 'private-number' }],
  }
}

describe('read-only directory observation', () => {
  it('retains directory facts but excludes contact and account fields without changing input', () => {
    const original = directory()
    const before = structuredClone(original)
    const report = buildDirectoryInspection(binding, original)
    expect(report).toMatchObject({ readOnly: true, applied: false, structure: { complete: true }, binding: { sourceState: 'disabled' } })
    expect(report.employees[0]).toEqual({ id: 'person-1', name: '员工甲', departmentIds: ['root', 'sales'], primaryDepartmentId: 'sales', status: 'active' })
    expect(JSON.stringify(report)).not.toContain('private-')
    expect(original).toEqual(before)
    report.employees[0].departmentIds.push('another')
    expect(original).toEqual(before)
  })

  it('compares content independently of pagination order and binds each observation to its connection and time', () => {
    const first = buildDirectoryInspection(binding, directory())
    const reordered = directory()
    reordered.departments.reverse()
    reordered.employees[0].departmentIds.reverse()
    expect(buildDirectoryInspection(binding, reordered).contentHash).toBe(first.contentHash)
    reordered.checkedAt = '2026-11-04T11:00:00.000Z'
    const newer = buildDirectoryInspection({ ...binding, connectionRevision: 'revision-2' }, reordered)
    expect(newer.contentHash).toBe(first.contentHash)
    expect(newer.observationHash).not.toBe(first.observationHash)
    reordered.employees[0].status = 'inactive'
    expect(buildDirectoryInspection(binding, reordered).contentHash).not.toBe(first.contentHash)
    expect(buildDirectoryInspection({ ...binding, externalTenantId: 'another-tenant' }, directory()).contentHash).not.toBe(first.contentHash)
  })

  it('never upgrades a provider flag, text assertion or matching totals into independent company scope proof', () => {
    const input = directory()
    input.scopeVerified = true
    input.scopeEvidence = 'all pages complete, count matches'
    expect(buildDirectoryInspection(binding, input).scope).toMatchObject({ verified: false, evidence: null, status: 'independent_evidence_required' })
  })

  it('explains cycles, missing parents, duplicates, unknown status and invalid personnel relationships', () => {
    const input = directory()
    input.departments[0].parentId = 'sales'
    input.departments.push({ id: 'orphan', name: '孤立部门', parentId: 'missing', status: 'unknown' })
    input.employees[0].departmentIds = ['missing', 'missing']
    input.employees.push({ ...input.employees[0], departmentIds: [], status: 'unknown' })
    const report = buildDirectoryInspection(binding, input)
    expect(report.structure.complete).toBe(false)
    expect(report.structure.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'department_cycle', 'missing_parent', 'unknown_status', 'duplicate_or_empty_id',
      'department_not_read', 'duplicate_department_relation', 'missing_department', 'invalid_primary_department',
    ]))
    expect(report.scope.verified).toBe(false)
  })

  it('rejects incomplete reads and unusable observation times', () => {
    const input = { ...directory(), complete: false, checkedAt: 'invalid' }
    expect(buildDirectoryInspection(binding, input).structure.issues.map(issue => issue.code)).toEqual([
      'provider_snapshot_incomplete', 'invalid_observation_time',
    ])
  })
})
