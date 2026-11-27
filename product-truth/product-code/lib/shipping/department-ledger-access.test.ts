import { describe, expect, it } from 'vitest'
import { loadDepartmentLedgerScope, selectLedgerDepartments } from './department-ledger-access'

const orgId = 'org-a'
const userId = 'user-a'
const subject = { org_id: orgId, user_id: userId }
const dept = (id: string, parent_id: string | null = null) => ({ id, name: id, org_id: orgId, status: 'active', parent_id })
const roleAt = (scope_id: string, code: string, permissions: string[], owner_org_id: string | null = null) => ({
  ...subject, scope_type: 'department', scope_id, roles: { id: code, code, permissions, owner_org_id },
})
const grant = (include_subdepartments: boolean) => ({ permissions: ['shipping:ledger_view'], include_subdepartments })

function source() {
  const rows: Record<string, unknown[]> = {
    user_roles: [
      roleAt('west', 'ORDINARY', ['shipping:ledger_view'], orgId),
      roleAt('no-authorization', 'FOREIGN_OWNED', ['shipping:ledger_view'], 'org-b'),
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
    async readRpcRows<T>(rpc: string, args: Record<string, string>): Promise<T[]> {
      expect(args).toEqual({ p_org_id: orgId, p_user_id: userId })
      return (rows[rpc] ?? []) as T[]
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

  it.each(['SHIPPING_OPERATOR', 'ORDINARY'])('uses the current explicit ledger grant for a %s department binding', async code => {
    const rest = source()
    rest.rows.user_roles = [roleAt('west', code, ['shipping:operate'])]
    expect(await loadDepartmentLedgerScope(rest, orgId, userId, {})).toEqual([])

    const options = await loadDepartmentLedgerScope(rest, orgId, userId, {
      role_permission_overrides: { [code]: ['shipping:ledger_view'] },
    })
    expect(options.map(option => option.id)).toEqual(['west', 'west-child'])
    expect(selectLedgerDepartments(options, 'east')).toBeNull()

    expect(await loadDepartmentLedgerScope(rest, orgId, userId, {
      role_permission_overrides: { [code]: ['shipping:*', '*'] },
    })).toEqual([])
  })

  it('anchors automatic ledger access to the affiliation, keeping identical manual assignments independent', async () => {
    const rest = source()
    const automatic = {
      rule_department_id: 'east',
      affiliation_department_id: 'east-child',
      role_code: 'AUTOMATIC_LEDGER',
      permissions: ['shipping:ledger_view'],
    }
    rest.rows.user_roles = [roleAt('east-child', automatic.role_code, ['shipping:ledger_view'])]
    rest.rows.department_automatic_role_sources_v1 = [
      automatic,
      { ...automatic, affiliation_department_id: 'west', permissions: ['shipping:record_return'] },
      { ...automatic, affiliation_department_id: 'north', role_code: 'SUPER_ADMIN' },
    ]
    expect(selectLedgerDepartments(await loadDepartmentLedgerScope(rest, orgId, userId, {}))).toEqual(['east-child'])
    rest.rows.department_automatic_role_sources_v1 = []
    expect(selectLedgerDepartments(await loadDepartmentLedgerScope(rest, orgId, userId, {}))).toEqual(['east-child'])
    rest.rows.user_roles = []
    expect(await loadDepartmentLedgerScope(rest, orgId, userId, {})).toEqual([])
  })

  it('keeps retired, system, foreign, inactive and legacy scope bindings out of the shipping ledger', async () => {
    const rest = source()
    const ledger = ['shipping:ledger_view']
    rest.rows.user_roles = [
      ...['SUPER_ADMIN', 'ORG_SUPER_ADMIN', 'FXIAOKE_BASELINE'].map(code => roleAt('west', code, ledger)),
      { ...roleAt('west', 'SHIPPING_OPERATOR', ledger), scope_type: 'space' },
      { ...roleAt('west', 'SHIPPING_OPERATOR', ledger), org_id: 'org-b' },
      { ...roleAt('west', 'SHIPPING_OPERATOR', ledger), user_id: 'another-member' },
      roleAt('west', 'SHIPPING_OPERATOR', ledger, 'org-b'),
      roleAt('disabled', 'SHIPPING_OPERATOR', ledger),
    ]
    expect(await loadDepartmentLedgerScope(rest, orgId, userId, {})).toEqual([])
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

  it('includes an independently granted descendant when there is an ungranted intermediate department', async () => {
    const rest = source()
    rest.rows.user_roles = [roleAt('authorized-grandchild', 'ORDINARY', ['shipping:ledger_view'])]
    rest.rows.department_lead_access = []
    rest.rows.departments = [
      dept('east'), dept('intermediate', 'east'), dept('authorized-grandchild', 'intermediate'),
      dept('ungranted-sibling', 'intermediate'), dept('another-parent'),
    ]
    const settings = { department_permission_grants: { east: grant(false) } }
    const options = await loadDepartmentLedgerScope(rest, orgId, userId, settings)
    expect(options.map(option => [option.id, option.parentId])).toEqual([
      ['east', null], ['authorized-grandchild', 'east'],
    ])
    expect(selectLedgerDepartments(options, 'east', true)).toEqual(['east', 'authorized-grandchild'])
    expect(selectLedgerDepartments(options, 'east')).toEqual(['east'])
    expect(selectLedgerDepartments(options, 'intermediate', true)).toBeNull()

    rest.rows.departments = [dept('east'), dept('another-parent'), dept('authorized-grandchild', 'another-parent')]
    const moved = await loadDepartmentLedgerScope(rest, orgId, userId, settings)
    expect(selectLedgerDepartments(moved, 'east', true)).toEqual(['east'])
    expect(selectLedgerDepartments(moved)).toEqual(['east', 'authorized-grandchild'])
  })

  it('does not grant a parent permission to a user merely assigned to its child', async () => {
    const rest = source()
    rest.rows.user_roles = []
    rest.rows.user_departments = [{ ...subject, department_id: 'east-child' }]
    expect(await loadDepartmentLedgerScope(rest, orgId, userId, { department_permission_grants: { east: grant(true) } })).toEqual([])
    expect(rest.queriedTables).not.toContain('departments')
  })
})
