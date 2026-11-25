import { describe, expect, it } from 'vitest'
import type { OrgSummaryDepartment, OrgSummaryUser, ScopedRoleAssignment } from '../types'
import { getRoleMembershipStats } from './role-membership-stats'

function activeUser(id: string, overrides: Partial<OrgSummaryUser> = {}): OrgSummaryUser {
  return {
    id, display_name: id, email: '', title: '', primary_dept_name: '',
    role_names: '', status: 'active', membership_status: 'active', employment_status: 'active', login_enabled: true,
    ...overrides,
  }
}

function binding(scopeType: ScopedRoleAssignment['scopeType'], scopeId: string | null, roleId = 'sales'): ScopedRoleAssignment {
  return { roleId, roleCode: 'SALES', roleName: '销售', scopeType, scopeId, scopeName: '', grantedAt: null }
}

function department(id: string, status: string): OrgSummaryDepartment {
  return { id, name: id, status, parent_name: null, member_count: 0 }
}

const context = {
  organization: { id: 'org', name: '当前组织' },
  departments: [department('open-department', 'active'), department('closed-department', 'inactive')],
  role_membership_stats: { effectiveAvailable: true, pendingAvailable: true, activeSpaceIds: ['open-space'] },
}
const pendingRole = { id: 'sales', code: 'SALES', name: '销售' }

describe('role membership statistics', () => {
  it('matches the role ID, deduplicates people and scopes, and counts valid scoped members', () => {
    const users = [
      activeUser('multi-scope', { role_ids: ['sales'], scoped_roles: [binding('org', 'org'), binding('department', 'open-department')] }),
      activeUser('multi-scope', { role_ids: ['sales'], scoped_roles: [binding('org', 'org'), binding('space', 'open-space')] }),
      activeUser('scoped-only', { scoped_roles: [binding('department', 'open-department')] }),
      activeUser('sales-manager', { role_names: '销售经理', role_codes: ['SALES_MANAGER'], role_ids: ['manager'], scoped_roles: [binding('org', 'org', 'manager')] }),
      activeUser('same-code-different-id', { role_codes: ['SALES'], scoped_roles: [binding('org', 'org', 'different-role')] }),
    ]

    const stats = getRoleMembershipStats(users, 'sales', context)
    expect(stats).toMatchObject({ effectiveMemberCount: 2, pendingMemberCount: 0, effectiveBindingCount: 4 })
    expect(stats.members.map(member => member.user.id)).toEqual(['multi-scope', 'scoped-only'])
    expect(stats.members[1]).toMatchObject({ hasOrgAssignment: false, effective: true })
  })

  it('does not count inactive members, disabled scopes or assignments from another organization', () => {
    const users = [
      activeUser('disabled-login', { login_enabled: false, scoped_roles: [binding('org', 'org')] }),
      activeUser('inactive-account', { status: 'inactive', scoped_roles: [binding('org', 'org')] }),
      activeUser('ended-membership', { membership_status: 'ended', scoped_roles: [binding('org', 'org')] }),
      activeUser('not-employed', { employment_status: 'suspended', scoped_roles: [binding('org', 'org')] }),
      activeUser('closed-department', { scoped_roles: [binding('department', 'closed-department')] }),
      activeUser('closed-space', { scoped_roles: [binding('space', 'closed-space')] }),
      activeUser('foreign-org', { scoped_roles: [binding('org', 'other-org')] }),
    ]

    const stats = getRoleMembershipStats(users, 'sales', context)
    expect(stats).toMatchObject({ effectiveMemberCount: 0, pendingMemberCount: 0, effectiveBindingCount: 0 })
    expect(stats.members).toHaveLength(6)
    expect(stats.members.every(member => member.effective === false)).toBe(true)
  })

  it.each(['SUPER_ADMIN', 'ORG_SUPER_ADMIN', 'SHIPPING_OPERATOR'])('counts only an exact organization %s binding and keeps historical rows visible', roleCode => {
    const roleId = 'exact-role'
    const orgBinding = { ...binding('org', 'org', roleId), roleCode }
    const departmentBinding = { ...orgBinding, scopeType: 'department' as const, scopeId: 'open-department' }
    const spaceBinding = { ...orgBinding, scopeType: 'space' as const, scopeId: 'open-space' }
    const users = [
      activeUser('organization-member', { scoped_roles: [orgBinding, departmentBinding, spaceBinding] }),
      activeUser('department-history', { scoped_roles: [departmentBinding] }),
      activeUser('space-history', { scoped_roles: [spaceBinding] }),
      activeUser('foreign-organization', { scoped_roles: [{ ...orgBinding, scopeId: 'other-org' }] }),
      activeUser('same-code-different-id', { scoped_roles: [{ ...orgBinding, roleId: 'different-role' }] }),
    ]

    const stats = getRoleMembershipStats(users, roleId, context)
    expect(stats).toMatchObject({ effectiveMemberCount: 1, effectiveBindingCount: 1 })
    expect(stats.members.map(({ user, effective }) => ({ id: user.id, effective }))).toEqual([
      { id: 'organization-member', effective: true },
      { id: 'department-history', effective: false },
      { id: 'space-history', effective: false },
    ])
  })

  it('deduplicates eligible first-login reservations separately from effective roles', () => {
    const pending = activeUser('pending', {
      status: 'inactive', membership_status: 'invited', login_enabled: false,
      can_preassign_org_roles: true, pending_org_roles: [pendingRole],
    })
    const users = [pending, pending, {
      ...pending, id: 'unverified', can_preassign_org_roles: false,
    }, {
      ...pending, id: 'other-pending-role', pending_org_roles: [{ ...pendingRole, id: 'different-role' }],
    }]

    const stats = getRoleMembershipStats(users, 'sales', context)
    expect(stats).toMatchObject({ effectiveMemberCount: 0, pendingMemberCount: 1, effectiveBindingCount: 0 })
    expect(stats.members).toHaveLength(1)
    expect(stats.members[0]).toMatchObject({ pending: true, effective: false })
  })

  it('keeps exact assignments visible when their counts cannot be verified', () => {
    const stats = getRoleMembershipStats([activeUser('known-role', { role_ids: ['sales'] })], 'sales', {
      ...context, role_membership_stats: { effectiveAvailable: false, pendingAvailable: false, activeSpaceIds: [] },
    })
    expect(stats).toMatchObject({ effectiveMemberCount: null, pendingMemberCount: null, effectiveBindingCount: null })
    expect(stats.members[0]).toMatchObject({ hasOrgAssignment: true, effective: null })
  })
})
