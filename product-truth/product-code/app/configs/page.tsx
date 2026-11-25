import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import {
  canAccessOrgAdmin, canReadRoleDirectory, hasConfigurationReadPermission, hasOrgDepartmentDirectoryPermission,
  hasOrganizationSourcePermission, hasPermission,
} from '@/lib/permissions'
import { ORG_SUPER_ADMIN_ROLE_CODE } from '@/lib/role-permission-resolution'
import ConfigsClient, { type ConfigsTabAccess } from './ConfigsClient'

type ConfigsPageProps = {
  searchParams?: Promise<{
    tab?: string | string[]
    ruleId?: string | string[]
    mode?: string | string[]
  }>
}

export default async function ConfigsPage({ searchParams }: ConfigsPageProps) {
  const [resolvedSearchParams, requestHeaders] = await Promise.all([searchParams, headers()])
  const readList = (key: string) => (requestHeaders.get(key) ?? '').split(',').filter(Boolean)
  const permissions = readList('x-user-permissions')
  const roleCodes = readList('x-user-role-codes')
  const authorizationRoleCodes = readList('x-user-authorization-role-codes')
  const canReadOrganization = canAccessOrgAdmin(permissions, authorizationRoleCodes)
  const canManageRoles = hasPermission(permissions, 'role:manage')
  const tabAccess: ConfigsTabAccess = {
    general: hasConfigurationReadPermission(permissions),
    organization: canReadOrganization || hasOrgDepartmentDirectoryPermission(permissions),
    roles: canReadRoleDirectory(permissions, authorizationRoleCodes),
    integrations: hasOrganizationSourcePermission(permissions) || authorizationRoleCodes.includes('ADMIN')
      || roleCodes.includes('SUPER_ADMIN') || (roleCodes.includes(ORG_SUPER_ADMIN_ROLE_CODE) && canManageRoles),
    shipping: requestHeaders.get('x-user-shipping-settings-view') === '1',
  }

  if (!Object.values(tabAccess).some(Boolean)) redirect('/')

  return (
    <ConfigsClient
      tabAccess={tabAccess}
      routeState={{
        tab: resolvedSearchParams?.tab,
        ruleId: resolvedSearchParams?.ruleId,
        mode: resolvedSearchParams?.mode,
      }}
    />
  )
}
