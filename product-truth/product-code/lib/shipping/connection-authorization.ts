import { getEffectiveShippingPermissions, SHIPPING_MANAGE_CONNECTIONS, type ShippingPermissionKey } from '@/lib/module-access'
import { loadOrgRolePermissionContext } from '@/lib/org-role-permissions'
import { loadShippingModulePermissionState } from '@/lib/permission-registry'
import { ShippingError } from './config'

export async function loadShippingConnectionAccess(userId: string) {
  const [context, publication] = await Promise.all([
    loadOrgRolePermissionContext(userId),
    loadShippingModulePermissionState(),
  ]).catch(() => { throw new ShippingError(503, '寄件连接管理授权读取失败。') })
  if (!context) throw new ShippingError(403, '当前账号没有可用的组织寄件配置。')
  return {
    orgId: context.orgId,
    permissions: getEffectiveShippingPermissions(context.actorPermissions, publication),
  }
}

export function checkShippingConnectionAccess(
  permissions: readonly ShippingPermissionKey[],
  required: ShippingPermissionKey | readonly ShippingPermissionKey[],
) {
  const keys = typeof required === 'string' ? [required] : required
  if (!keys.every(key => permissions.includes(key))) {
    throw new ShippingError(403, '当前账号没有执行此寄件设置操作的权限。')
  }
}

export async function requireShippingConnectionManager(
  userId: string,
  permission: ShippingPermissionKey | readonly ShippingPermissionKey[] = SHIPPING_MANAGE_CONNECTIONS,
) {
  const access = await loadShippingConnectionAccess(userId)
  checkShippingConnectionAccess(access.permissions, permission)
  return access.orgId
}
