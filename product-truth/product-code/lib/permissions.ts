const ORG_DELEGATION_SENSITIVE_RESOURCES = new Set([
  'admin', 'org', 'user', 'dept', 'config', 'role', 'permission', 'platform', 'report', 'feishu',
])

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
