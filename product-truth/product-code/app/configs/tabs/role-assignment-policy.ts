import type { OrgSummaryUser } from '../types'

export type RoleMutationRestrictionCode =
  | 'MEMBER_NOT_ELIGIBLE'
  | 'IDENTITY_UNRESOLVED'
  | 'SELF_ROLE_MUTATION_FORBIDDEN'
  | 'PROTECTED_ROLE_MUTATION_FORBIDDEN'

export type RoleMutationRestriction = {
  code: RoleMutationRestrictionCode
  label: string
  reason: string
}

const IDENTITY_UNRESOLVED_RESTRICTION: RoleMutationRestriction = {
  code: 'IDENTITY_UNRESOLVED',
  label: '身份确认中',
  reason: '当前登录身份尚未确认，角色分配暂不可用。',
}

const SELF_ROLE_MUTATION_RESTRICTION: RoleMutationRestriction = {
  code: 'SELF_ROLE_MUTATION_FORBIDDEN',
  label: '当前账号角色只读',
  reason: '不能在当前会话中修改自己的角色，请由其他组织管理员操作。',
}

const PROTECTED_ROLE_MUTATION_RESTRICTION: RoleMutationRestriction = {
  code: 'PROTECTED_ROLE_MUTATION_FORBIDDEN',
  label: '平台根管理员只读',
  reason: 'SUPER_ADMIN 是平台根角色，不能通过组织管理界面变更。',
}

export function editableOrgRoleIds(user: OrgSummaryUser): string[] {
  return [...new Set([...(user.role_ids ?? []), ...(user.pending_org_roles ?? []).map(role => role.id)])]
}

export function userHasPendingOrgRole(user: OrgSummaryUser, roleId: string): boolean {
  return user.pending_org_roles?.some(role => role.id === roleId) ?? false
}

export function userHasProtectedPlatformRole(user: OrgSummaryUser): boolean {
  return Boolean(
    user.role_codes?.includes('SUPER_ADMIN')
    || user.scoped_roles?.some((assignment) => (
      assignment.scopeType === 'org' && assignment.roleCode === 'SUPER_ADMIN'
    ))
  )
}

export function getRoleMutationRestriction(
  user: OrgSummaryUser,
  currentUserId: string | null
): RoleMutationRestriction | null {
  if (!currentUserId) {
    return IDENTITY_UNRESOLVED_RESTRICTION
  }

  if (userHasProtectedPlatformRole(user)) {
    return PROTECTED_ROLE_MUTATION_RESTRICTION
  }

  if (user.id === currentUserId) {
    return SELF_ROLE_MUTATION_RESTRICTION
  }

  if (user.membership_status === 'invited' && !user.can_preassign_org_roles) {
    return { code: 'MEMBER_NOT_ELIGIBLE', label: '暂不可分配', reason: '仅已核实且在职的纷享目录成员可在首次登录前预分配组织角色。' }
  }

  return null
}

export function partitionRoleMutationTargets(
  users: OrgSummaryUser[],
  currentUserId: string | null
): { eligible: OrgSummaryUser[]; restricted: OrgSummaryUser[] } {
  const eligible: OrgSummaryUser[] = []
  const restricted: OrgSummaryUser[] = []

  for (const user of users) {
    if (getRoleMutationRestriction(user, currentUserId)) {
      restricted.push(user)
    } else {
      eligible.push(user)
    }
  }

  return { eligible, restricted }
}
