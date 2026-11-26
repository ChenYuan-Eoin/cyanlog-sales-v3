const ORG_DELEGATION_SENSITIVE_RESOURCES = new Set([
  'admin', 'org', 'user', 'dept', 'config', 'role', 'permission', 'platform', 'report', 'feishu',
])

export const ORG_MEMBER_EDIT = 'user:edit_profile'
export const ORG_BUSINESS_ROLE_ASSIGN = 'user:assign_roles'
export const ROLE_DIRECTORY_VIEW = 'role:view'
export const ORG_DEPARTMENT_DIRECTORY_VIEW = 'dept:directory_view'
export const ORG_DEPARTMENT_STRUCTURE_EDIT = 'dept:edit_structure'
export const ORG_DEPARTMENT_STRUCTURE_DELETE = 'dept:delete_structure'
export const ORG_DEPARTMENT_STRUCTURE_PERMISSION_KEYS = [
  ORG_DEPARTMENT_DIRECTORY_VIEW, ORG_DEPARTMENT_STRUCTURE_EDIT, ORG_DEPARTMENT_STRUCTURE_DELETE,
] as const
export const ORGANIZATION_SOURCE_PERMISSION_KEYS = [
  'org:source_view', 'org:source_connect', 'org:source_preview', 'org:source_apply',
] as const

export function hasConfigurationReadPermission(permissions: string[]): boolean {
  return ['config:read', 'config:write', 'config:publish'].some(key => hasPermission(permissions, key))
}

export function canReadRoleDirectory(permissions: string[], authorizationRoleCodes: string[]): boolean {
  return hasPermission(permissions, 'role:manage')
    || (hasPermission(permissions, ROLE_DIRECTORY_VIEW) && hasPermission(permissions, 'user:view'))
    || authorizationRoleCodes.some(code => code === 'ADMIN' || code === 'SALES_OPS' || code === 'SUPER_ADMIN')
}

export function isSystemAuthorizationGrant(roleCode: string, permissions: string[]): boolean {
  return roleCode === 'SUPER_ADMIN' && hasPermission(permissions, 'role:manage')
}

export function hasOrganizationSourcePermission(permissions: string[]): boolean {
  return ORGANIZATION_SOURCE_PERMISSION_KEYS.some(key => hasPermission(permissions, key))
}

export function hasOrgDepartmentDirectoryPermission(permissions: string[]): boolean {
  return hasPermission(permissions, ORG_DEPARTMENT_DIRECTORY_VIEW)
}

export function canEnterConfigurationCenter(permissions: string[], authorizationRoleCodes: string[]): boolean {
  return hasConfigurationReadPermission(permissions)
    || canAccessOrgAdmin(permissions, authorizationRoleCodes)
    || hasOrganizationSourcePermission(permissions)
    || hasOrgDepartmentDirectoryPermission(permissions)
    || canReadRoleDirectory(permissions, authorizationRoleCodes)
}

export function hasLegacyOrgMemberWrite(permissions: string[], authorizationRoleCodes: string[]): boolean {
  return authorizationRoleCodes.includes('SUPER_ADMIN') || authorizationRoleCodes.includes('ADMIN')
    || hasPermission(permissions, 'user:write') || hasPermission(permissions, 'org:write')
}

export function hasLegacyDepartmentStructureWrite(permissions: string[], authorizationRoleCodes: string[]): boolean {
  return authorizationRoleCodes.includes('SUPER_ADMIN') || authorizationRoleCodes.includes('ADMIN')
    || hasPermission(permissions, 'dept:write') || hasPermission(permissions, 'org:write')
}

export function isOrgDelegationSensitivePermission(permission: string): boolean {
  return permission === '*' || ORG_DELEGATION_SENSITIVE_RESOURCES.has(permission.split(':')[0])
}

export function hasPermission(allPermissions: string[], required: string): boolean {
  if (allPermissions.includes('*') || allPermissions.includes(required)) {
    return true
  }

  const [requiredResource] = required.split(':')
  return allPermissions.some((permission) => {
    if (permission === '*') {
      return true
    }
    if (!permission.includes(':')) {
      return permission === required
    }

    const [resource, action] = permission.split(':')
    return resource === requiredResource && action === '*'
  })
}

export function canAccessOrgAdmin(allPermissions: string[], roleCodes: string[]): boolean {
  if (
    roleCodes.includes('SUPER_ADMIN')
    || roleCodes.includes('SALES_OPS')
    || roleCodes.includes('ADMIN')
  ) {
    return true
  }

  return (
    hasPermission(allPermissions, '*')
    || hasPermission(allPermissions, 'admin:access')
    || hasPermission(allPermissions, 'org:write')
    || hasPermission(allPermissions, 'user:view')
    || hasPermission(allPermissions, 'user:write')
  )
}

export function canReviewContracts(allPermissions: string[], roleCodes: string[]): boolean {
  if (
    roleCodes.includes('SUPER_ADMIN')
    || roleCodes.includes('ADMIN')
    || roleCodes.includes('LEGAL')
  ) {
    return true
  }

  return (
    hasPermission(allPermissions, '*')
    || hasPermission(allPermissions, 'contract:*')
    || hasPermission(allPermissions, 'contract:review')
    || hasPermission(allPermissions, 'contract:write')
  )
}
