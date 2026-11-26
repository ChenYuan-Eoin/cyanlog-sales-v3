import { describe, expect, it } from 'vitest'
import { loadDepartmentLedgerScope, selectLedgerDepartments } from './department-ledger-access'

const orgId = 'org-a'
const userId = 'user-a'
const subject = { org_id: orgId, user_id: userId }
const dept = (id: string, parent_id: string | null = null) => ({ id, name: id, org_id: orgId, status: 'active', parent_id })
const roleAt = (scope_id: string, code: string, permissions: string[]) => ({
  ...subject, scope_type: 'department', scope_id, roles: { id: code, code, permissions },
})
const grant = (include_subdepartments: boolean) => ({ permissions: ['shipping:ledger_view'], include_subdepartments })

function source() {
  const rows: Record<string, unknown[]> = {
    user_roles: [
      roleAt('west', 'ORDINARY', ['shipping:ledger_view']),
      roleAt('no-authorization', 'ADMIN', ['shipping:*']),
      roleAt('no-authorization', 'SUPER_ADMIN', ['shipping:ledger_view']),
      { ...roleAt('foreign', 'OTHER', ['shipping:ledger_view']), org_id: 'org-b' },
    ],
    user_departments: [{ ...subject, department_id: 'east' }, { ...subject, department_id: 'no-authorization' }],
    department_lead_access: [
      { ...subject, department_id: 'north', department: { ...dept('north'), leader_id: userId } },
      { ...subject, department_id: 'no-authorization', department: { ...dept('no-authorization'), leader_id: 'reassigned' } },
    ],
    departments: [
      dept('east'), dept('east-child', 'east'), dept('west'), dept('west-child', 'west'),
      dept('north'), dept('north-child', 'north'), dept('no-authorization'),
      { ...dept('foreign', 'east'), org_id: 'org-b' }, { ...dept('disabled', 'east'), status: 'inactive' },
    ],
  }
  const queriedTables: string[] = []
  return {
    rows, queriedTables,
    async selectRows<T>(table: string): Promise<T[]> {
      queriedTables.push(table)
      return (rows[table] ?? []) as T[]
    },
  }
}

describe('explicit department shipping grants', () => {
  it('unions eligible department and role grants for ledger view, ignoring all ungranted departments', async () => {
    const rest = source()
    const options = await loadDepartmentLedgerScope(rest, orgId, userId, {
      department_permission_grants: { east: grant(true), north: grant(false) },
    })
    expect(options.map(option => option.id)).toEqual(['east', 'east-child', 'west', 'west-child', 'north'])
    expect(selectLedgerDepartments(options, 'east')).toEqual(['east'])
    expect(selectLedgerDepartments(options, 'east', true)).toEqual(['east', 'east-child'])
    expect(selectLedgerDepartments(options, 'north', true)).toEqual(['north'])
    expect(selectLedgerDepartments(options, 'no-authorization')).toBeNull()
  })

  it('recomputes expanded scopes after reparenting, new departments and revocation', async () => {
    const rest = source()
    const settings = {
      department_permission_grants: { east: grant(true) },
      role_permission_overrides: { ORDINARY: [] },
    }
    const initial = await loadDepartmentLedgerScope(rest, orgId, userId, settings)
    expect(initial.map(option => option.id)).toEqual(['east', 'east-child'])
    rest.rows.departments = [dept('east'), dept('east-child', 'north'), dept('new', 'east'), dept('north')]
    const moved = await loadDepartmentLedgerScope(rest, orgId, userId, settings)
    expect(moved.map(option => option.id)).toEqual(['east', 'new'])
    expect(await loadDepartmentLedgerScope(rest, orgId, userId, { ...settings, department_permission_grants: {} })).toEqual([])
  })

  it('does not grant a parent permission to a user merely assigned to its child', async () => {
    const rest = source()
    rest.rows.user_roles = []
    rest.rows.user_departments = [{ ...subject, department_id: 'east-child' }]
    expect(await loadDepartmentLedgerScope(rest, orgId, userId, { department_permission_grants: { east: grant(true) } })).toEqual([])
    expect(rest.queriedTables).not.toContain('departments')
  })
})
