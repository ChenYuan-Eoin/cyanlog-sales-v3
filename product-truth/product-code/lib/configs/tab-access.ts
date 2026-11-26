import { readOrganizationPermissionDecision, type OrganizationPermissionDecision } from '@/lib/admin/organization-permission-decision'
import {
  canReadOrgDepartmentDirectory, canReadRoleDirectory, hasConfigurationReadPermission,
  hasOrganizationSourcePermission, isSystemAuthorizationGrant,
} from '@/lib/permissions'

export interface ConfigsTabAccess {
  general: boolean
  organization: boolean
  integrations: boolean
  roles: boolean
  shipping: boolean
}

export function getConfigsTabAccess({
  permissions, systemAdministrator = false, shippingSettingsView = false, organizationActions,
}: {
  permissions: string[]
  systemAdministrator?: boolean
  shippingSettingsView?: boolean
  organizationActions?: OrganizationPermissionDecision | null
}): ConfigsTabAccess {
  return {
    general: hasConfigurationReadPermission(permissions),
    organization: organizationActions
      ? organizationActions['user:view'] || organizationActions['dept:directory_view']
      : canReadOrgDepartmentDirectory(permissions),
    integrations: hasOrganizationSourcePermission(permissions, systemAdministrator),
    roles: organizationActions?.['role:view'] ?? canReadRoleDirectory(permissions),
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
  const permissions = list('x-user-permissions')
  return getConfigsTabAccess({
    permissions,
    systemAdministrator: list('x-user-role-codes').some(code => isSystemAuthorizationGrant(code, permissions)),
    shippingSettingsView,
    organizationActions: readOrganizationPermissionDecision(headers),
  })
}
