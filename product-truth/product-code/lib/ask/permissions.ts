import {
  canReviewContracts,
  getOrgPermissions,
  getOrgAuthorizationRoleCodes,
  getOrgRoleCodes,
  type ScopedRoleAssignment,
} from '@/lib/scoped-access'

const ROLE_ALIASES: Record<string, string> = {
  SALES: 'SALES',
  SALES_MANAGER: 'SALES',
  COMMERCIAL: 'SALES',
  BUSINESS: 'SALES',
  销售: 'SALES',
  商务: 'SALES',
  FINANCE: 'FINANCE',
  FINANCIAL: 'FINANCE',
  财务: 'FINANCE',
  LEGAL: 'LEGAL',
  COMPLIANCE: 'LEGAL',
  法务: 'LEGAL',
  合规: 'LEGAL',
  TECHNICAL: 'TECHNICAL',
  DELIVERY: 'TECHNICAL',
  交付: 'TECHNICAL',
  技术: 'TECHNICAL',
}

export function normalizeAskRole(role: string | null | undefined): string {
  if (!role) return ''
  const key = role.trim().replace(/[-\s]/g, '_').toUpperCase()
  return ROLE_ALIASES[key] || key
}

export function getAskRoleCodes(assignments: ScopedRoleAssignment[], orgId: string): string[] {
  return Array.from(new Set(
    getOrgRoleCodes(assignments, orgId)
      .map((roleCode) => normalizeAskRole(roleCode))
      .filter(Boolean)
  ))
}

export function canManageAllAsks(assignments: ScopedRoleAssignment[], orgId: string): boolean {
  const roleCodes = getOrgAuthorizationRoleCodes(assignments, orgId)
  return (
    roleCodes.includes('SUPER_ADMIN')
    || roleCodes.includes('ADMIN')
    || canReviewContracts(assignments, orgId)
  )
}

export function canAccessAskByRoles(
  requiredRoles: string[] | null | undefined,
  assignments: ScopedRoleAssignment[],
  orgId: string
): boolean {
  if (canManageAllAsks(assignments, orgId)) {
    return true
  }

  const normalizedRequired = (requiredRoles || [])
    .map((role) => normalizeAskRole(role))
    .filter(Boolean)

  if (normalizedRequired.length === 0) {
    return false
  }

  const userRoleCodes = getAskRoleCodes(assignments, orgId)
  return normalizedRequired.some((role) => userRoleCodes.includes(role))
}

export function getAskResponderRole(assignments: ScopedRoleAssignment[], orgId: string): string {
  const orgRole = getOrgRoleCodes(assignments, orgId)[0]
  const askRole = getAskRoleCodes(assignments, orgId)[0]
  return orgRole || askRole || 'unknown'
}

export function canCloseOrReopenAsk(assignments: ScopedRoleAssignment[], orgId: string): boolean {
  return (
    canManageAllAsks(assignments, orgId)
    || getOrgPermissions(assignments, orgId).includes('contract:review')
  )
}
