import {
  canAccessOrgAdmin, canReadRoleDirectory, hasConfigurationReadPermission,
  hasOrgDepartmentDirectoryPermission, hasOrganizationSourcePermission, hasPermission,
} from '@/lib/permissions'
import { ORG_SUPER_ADMIN_ROLE_CODE } from '@/lib/role-permission-resolution'

export interface ConfigsTabAccess {
  general: boolean
  organization: boolean
  integrations: boolean
  roles: boolean
  shipping: boolean
}

export function getConfigsTabAccess({
  permissions, roleCodes = [], authorizationRoleCodes = [], shippingSettingsView = false,
}: {
  permissions: string[]
  roleCodes?: string[]
  authorizationRoleCodes?: string[]
  shippingSettingsView?: boolean
}): ConfigsTabAccess {
  return {
    general: hasConfigurationReadPermission(permissions),
    organization: canAccessOrgAdmin(permissions, authorizationRoleCodes) || hasOrgDepartmentDirectoryPermission(permissions),
    integrations: hasOrganizationSourcePermission(permissions) || authorizationRoleCodes.includes('ADMIN')
      || roleCodes.includes('SUPER_ADMIN')
      || (roleCodes.includes(ORG_SUPER_ADMIN_ROLE_CODE) && hasPermission(permissions, 'role:manage')),
    roles: canReadRoleDirectory(permissions, authorizationRoleCodes),
    shipping: shippingSettingsView,
  }
}

export function hasConfigsTabAccess(access: ConfigsTabAccess): boolean {
  return Object.values(access).some(Boolean)
}

export function readConfigsTabAccess(
  headers: Pick<Headers, 'get'>,
  shippingSettingsView = headers.get('x-user-shipping-settings-view') === '1',
): ConfigsTabAccess {
  const list = (key: string) => (headers.get(key) ?? '').split(',').filter(Boolean)
  return getConfigsTabAccess({
    permissions: list('x-user-permissions'),
    roleCodes: list('x-user-role-codes'),
    authorizationRoleCodes: list('x-user-authorization-role-codes'),
    shippingSettingsView,
  })
}
