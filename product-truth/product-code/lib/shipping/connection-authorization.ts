import { getDefaultOrgId, getOrgPermissions, getOrgAuthorizationRoleCodes, getUserScopedRoleAssignments } from '@/lib/scoped-access'
import { hasPermission } from '@/lib/permissions'
import { ShippingError } from './config'

export async function requireShippingConnectionManager(userId: string) {
  const orgId = await getDefaultOrgId(userId)
  if (!orgId) throw new ShippingError(403, '当前账号没有可用的组织寄件配置。')
  const assignments = await getUserScopedRoleAssignments(userId)
  const roleCodes = getOrgAuthorizationRoleCodes(assignments, orgId)
  const permissions = getOrgPermissions(assignments, orgId)
  if (!roleCodes.some((role) => ['SUPER_ADMIN', 'ADMIN'].includes(role)) && !hasPermission(permissions, 'shipping:manage_connections')) {
    throw new ShippingError(403, '需要寄件连接管理权限。')
  }
  return orgId
}
