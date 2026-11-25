import { describe, expect, it } from 'vitest'
import { buildDepartmentSpaces, resolveDepartmentSpaceIds } from './department-spaces'

const spaces = buildDepartmentSpaces([
  { id: 'org-root', name: '公司' },
  { id: 'a', name: '部门 A', parent_id: 'org-root' },
  { id: 'a1', name: '部门 A1', parent_id: 'a' },
  { id: 'a2', name: '部门 A2', parent_id: 'a' },
  { id: 'b', name: '部门 B', parent_id: 'org-root' },
  { id: 'b1', name: '部门 B1', parent_id: 'b' },
  { id: 'c', name: '部门 C', parent_id: 'org-root' },
  { id: 'inactive', name: '已停用', parent_id: 'a', status: 'inactive' },
], [])

describe('resolveDepartmentSpaceIds', () => {
  it('unions sibling branches and deduplicates overlapping assignments', () => {
    expect(resolveDepartmentSpaceIds(spaces, ['a', 'a1', 'b'])).toEqual(new Set(['a', 'a1', 'a2', 'b', 'b1']))
  })

  it('supports exact selection, subtree selection, and separate child selection', () => {
    const roots = ['a', 'a1', 'b']
    expect(resolveDepartmentSpaceIds(spaces, roots, { departmentId: 'a', includeSubdepartments: false })).toEqual(new Set(['a']))
    expect(resolveDepartmentSpaceIds(spaces, roots, { departmentId: 'a', includeSubdepartments: true })).toEqual(new Set(['a', 'a1', 'a2']))
    expect(resolveDepartmentSpaceIds(spaces, roots, { departmentId: 'a1', includeSubdepartments: false })).toEqual(new Set(['a1']))
    expect(resolveDepartmentSpaceIds(spaces, roots, { departmentId: 'b', includeSubdepartments: true })).toEqual(new Set(['b', 'b1']))
  })

  it('returns no data for parents or branches outside the granted roots, including inactive departments', () => {
    const roots = ['a', 'b', 'inactive', 'other-org']
    for (const departmentId of ['org-root', 'c', 'inactive', 'other-org']) {
      expect(resolveDepartmentSpaceIds(spaces, roots, { departmentId, includeSubdepartments: true })).toEqual(new Set())
    }
    expect(resolveDepartmentSpaceIds(spaces, [], { departmentId: 'a', includeSubdepartments: false })).toEqual(new Set())
  })
})
