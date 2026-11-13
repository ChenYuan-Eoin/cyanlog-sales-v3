// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_INTAKE_RULES, effectiveShippingDepartmentIds } from './intake-rules'

const id = { root: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', child: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', other: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', inactive: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }
const rows = [
  { id: id.root, name: '销售', parent_id: null, status: 'active' },
  { id: id.child, name: '一部', parent_id: id.root, status: 'active' },
  { id: id.other, name: '一部', parent_id: null, status: 'active' },
  { id: id.inactive, name: '停用部门', parent_id: null, status: 'inactive' },
]
const db = vi.hoisted(() => ({ departments: [] as unknown[], assignments: [] as unknown[], membership: { status: 'active', employment_status: 'active' }, error: false, calls: [] as Array<{ table: string; filters: Record<string, unknown> }> }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: (table: string) => {
  const filters: Record<string, unknown> = {}
  db.calls.push({ table, filters })
  const query = {
    select: () => query,
    eq: (field: string, value: unknown) => { filters[field] = value; return query },
    order: () => query,
    limit: async () => ({ data: table === 'departments' ? db.departments : db.assignments, error: db.error ? { message: 'unavailable' } : null }),
    maybeSingle: async () => ({ data: db.membership, error: db.error ? { message: 'unavailable' } : null }),
  }
  return query
} } }))
import { activeShippingDepartments, loadEmployeeShippingDepartments, resolveEmployeeShippingDepartment, validateShippingDepartmentRoots } from './department-access'

beforeEach(() => { db.departments = rows; db.assignments = [{ department_id: id.child, is_primary: true }, { department_id: id.other, is_primary: false }]; db.membership = { status: 'active', employment_status: 'active' }; db.error = false; db.calls = [] })

it('opens every active descendant of a selected parent, while keeping duplicate department names distinct', () => {
  const departments = activeShippingDepartments(rows)
  expect([...effectiveShippingDepartmentIds(departments, [id.root])].sort()).toEqual([id.root, id.child].sort())
  expect(effectiveShippingDepartmentIds(departments, []).size).toBe(0)
  expect(effectiveShippingDepartmentIds(departments, null).size).toBe(3)
  expect(departments.find(item => item.id === id.child)?.path).toBe('销售 / 一部')
  expect(departments.some(item => item.id === id.inactive)).toBe(false)
})

it('uses only the current employee and organization membership and rejects a forged department ID', async () => {
  const departments = await loadEmployeeShippingDepartments('person-1', 'org-1', { ...DEFAULT_INTAKE_RULES, allowedDepartmentIds: [id.root] })
  expect(departments.map(item => item.id)).toEqual([id.child])
  expect(db.calls).toEqual(expect.arrayContaining([
    expect.objectContaining({ table: 'user_departments', filters: { org_id: 'org-1', user_id: 'person-1' } }),
    expect.objectContaining({ table: 'departments', filters: { org_id: 'org-1' } }),
  ]))
  expect(resolveEmployeeShippingDepartment(departments, id.child).name).toBe('一部')
  expect(() => resolveEmployeeShippingDepartment(departments, id.other, '一部')).toThrow('所属部门未开放提报')
})

it('rejects a suspended employee and cross-organization or inactive configuration roots', async () => {
  db.membership = { status: 'active', employment_status: 'suspended' }
  await expect(loadEmployeeShippingDepartments('person-1', 'org-1', DEFAULT_INTAKE_RULES)).rejects.toMatchObject({ status: 403 })
  await expect(validateShippingDepartmentRoots('org-1', [id.inactive])).rejects.toMatchObject({ status: 400 })
  await expect(validateShippingDepartmentRoots('org-1', [id.other, id.other])).rejects.toMatchObject({ status: 400 })
})
