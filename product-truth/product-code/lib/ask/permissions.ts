import {
  canReviewContracts,
  getOrgPermissions,
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

export function getAskRoleCodes(assignments: ScopedRoleAssignment[]): string[] {
  return Array.from(new Set(
    assignments
      .map((assignment) => normalizeAskRole(assignment.roleCode))
      .filter(Boolean)
  ))
}

export function canManageAllAsks(assignments: ScopedRoleAssignment[]): boolean {
  const roleCodes = getOrgRoleCodes(assignments)
  return (
    roleCodes.includes('SUPER_ADMIN')
    || roleCodes.includes('ADMIN')
    || canReviewContracts(assignments)
  )
}

export function canAccessAskByRoles(
  requiredRoles: string[] | null | undefined,
  assignments: ScopedRoleAssignment[]
): boolean {
  if (canManageAllAsks(assignments)) {
    return true
  }

  const normalizedRequired = (requiredRoles || [])
    .map((role) => normalizeAskRole(role))
    .filter(Boolean)

  if (normalizedRequired.length === 0) {
    return false
  }

  const userRoleCodes = getAskRoleCodes(assignments)
  return normalizedRequired.some((role) => userRoleCodes.includes(role))
}

export function getAskResponderRole(assignments: ScopedRoleAssignment[]): string {
  const orgRole = getOrgRoleCodes(assignments)[0]
  const askRole = getAskRoleCodes(assignments)[0]
  return orgRole || askRole || 'unknown'
}

export function canCloseOrReopenAsk(assignments: ScopedRoleAssignment[]): boolean {
  return (
    canManageAllAsks(assignments)
    || getOrgPermissions(assignments).includes('contract:review')
  )
}
