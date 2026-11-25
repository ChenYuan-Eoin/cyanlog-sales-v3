import { SHIPPING_MANAGE_CONNECTIONS } from '@/lib/module-access'
import { loadOrgRolePermissionContext } from '@/lib/org-role-permissions'
import { loadPublishedModulePermissionKeys } from '@/lib/permission-registry'
import { hasPermission } from '@/lib/permissions'
import { ShippingError } from './config'

export async function requireShippingConnectionManager(userId: string) {
  const [context, publishedKeys] = await Promise.all([
    loadOrgRolePermissionContext(userId),
    loadPublishedModulePermissionKeys(),
  ]).catch(() => { throw new ShippingError(503, '寄件连接管理授权读取失败。') })
  if (!context) throw new ShippingError(403, '当前账号没有可用的组织寄件配置。')
  if (!publishedKeys.includes(SHIPPING_MANAGE_CONNECTIONS)
    || !hasPermission(context.actorPermissions, SHIPPING_MANAGE_CONNECTIONS)) {
    throw new ShippingError(403, '需要寄件连接管理权限。')
  }
  return context.orgId
}
