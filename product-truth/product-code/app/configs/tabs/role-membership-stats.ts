import { isRoleAssignableInScope, ORG_SUPER_ADMIN_ROLE_CODE } from '@/lib/role-permission-resolution'
import type { DepartmentAutomaticRoleSource, OrgSummaryPayload, OrgSummaryUser } from '../types'
import { canOnlyRevokePendingOrgRoles, userHasPendingOrgRole } from './role-assignment-policy'

export interface RoleMember {
  user: OrgSummaryUser
  hasOrgAssignment: boolean
  automaticSources: DepartmentAutomaticRoleSource[]
  pending: boolean
  effective: boolean | null
}

export interface RoleMembershipStats {
  members: RoleMember[]
  effectiveMemberCount: number | null
  pendingMemberCount: number | null
  effectiveBindingCount: number | null
  automaticSourcesAvailable?: boolean
}

type RoleMembershipContext = Pick<OrgSummaryPayload, 'organization' | 'departments' | 'role_membership_stats'>

export function getRoleMembershipStats(
  users: readonly OrgSummaryUser[],
  roleId: string,
  context?: RoleMembershipContext | null,
  departmentScopeAvailable = false,
): RoleMembershipStats {
  const orgId = context?.organization?.id
  const basis = context?.role_membership_stats
  const automaticSourcesAvailable = basis?.automaticSourcesAvailable
  const effectiveAvailable = Boolean(orgId && basis?.effectiveAvailable && automaticSourcesAvailable !== false)
  const activeDepartmentIds = new Set(context?.departments.filter(department => department.status === 'active').map(department => department.id))
  const activeSpaceIds = new Set(basis?.activeSpaceIds)
  const activeMemberIds = basis?.activeMemberIds ? new Set(basis.activeMemberIds) : null
  const rows = new Map<string, {
    member: RoleMember
    eligible: boolean
    bindings: Set<string>
    sourceKeys: Set<string>
  }>()

  for (const user of users) {
    const bindings = (user.scoped_roles ?? []).filter(binding => binding.roleId === roleId
      && (binding.scopeType !== 'org' || !orgId || !binding.scopeId || binding.scopeId === orgId))
    const hasOrgAssignment = Boolean(user.role_ids?.includes(roleId) || bindings.some(binding => binding.scopeType === 'org'))
    const automaticSources = user.automatic_role_sources?.filter(source => source.roleId === roleId) ?? []
    const pending = user.membership_status === 'invited'
      && user.status === 'inactive'
      && (!user.employment_status || user.employment_status === 'active')
      && (user.can_preassign_org_roles === true || canOnlyRevokePendingOrgRoles(user))
      && userHasPendingOrgRole(user, roleId)
    if (!hasOrgAssignment && !pending && bindings.length === 0 && automaticSources.length === 0) continue

    const eligible = user.status === 'active' && user.login_enabled === true
      && user.membership_status === 'active' && user.employment_status === 'active'
      && (activeMemberIds === null || activeMemberIds.has(user.id))
    const state = rows.get(user.id) ?? {
      member: { user, hasOrgAssignment: false, automaticSources: [], pending: false, effective: null },
      eligible: true,
      bindings: new Set<string>(),
      sourceKeys: new Set<string>(),
    }
    state.member.hasOrgAssignment ||= hasOrgAssignment
    state.member.pending ||= pending
    state.eligible &&= eligible
    for (const source of automaticSources) {
      const { ruleDepartmentId, affiliationDepartmentId } = source
      const key = JSON.stringify([ruleDepartmentId, affiliationDepartmentId])
      if (state.sourceKeys.has(key)) continue
      state.sourceKeys.add(key)
      state.member.automaticSources.push(source)
      if (effectiveAvailable && activeDepartmentIds.has(affiliationDepartmentId)) {
        state.bindings.add(`department:${affiliationDepartmentId}`)
      }
    }
    if (effectiveAvailable) {
      for (const binding of bindings) {
        const { roleCode, scopeType, scopeId } = binding
        if (scopeType !== 'org' && (roleCode === 'SUPER_ADMIN' || roleCode === ORG_SUPER_ADMIN_ROLE_CODE)) continue
        if (scopeId && isRoleAssignableInScope(roleCode, scopeType, departmentScopeAvailable) && (
          (scopeType === 'org' && scopeId === orgId)
          || (scopeType === 'department' && activeDepartmentIds.has(scopeId))
          || (scopeType === 'space' && activeSpaceIds.has(scopeId))
        )) {
          state.bindings.add(`${scopeType}:${scopeId}`)
        }
      }
    }
    rows.set(user.id, state)
  }

  let effectiveMemberCount = 0
  let effectiveBindingCount = 0
  let pendingMemberCount = 0
  const members: RoleMember[] = []
  for (const { member, eligible, bindings } of rows.values()) {
    member.effective = effectiveAvailable ? eligible && bindings.size > 0 : null
    if (member.effective) {
      effectiveMemberCount += 1
      effectiveBindingCount += bindings.size
    }
    if (member.pending && member.user.can_preassign_org_roles === true) pendingMemberCount += 1
    members.push(member)
  }

  return {
    members,
    automaticSourcesAvailable,
    effectiveMemberCount: effectiveAvailable ? effectiveMemberCount : null,
    pendingMemberCount: orgId && basis?.pendingAvailable ? pendingMemberCount : null,
    effectiveBindingCount: effectiveAvailable ? effectiveBindingCount : null,
  }
}
