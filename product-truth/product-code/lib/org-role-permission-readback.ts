export type ConfigRoleRecord = {
  id: string
  code: string
  name: string
  description: string | null
  permissions: string[] | null
  sort_order: number | null
  permissions_edit_block_reason?: string | null
  owner_shipping_permissions?: string[]
}

export type RoleModulePermissionCatalog = Array<{
  id: string
  label: string
  description: string
  items: Array<{ key: string; label: string; description: string; dependencies: string[] }>
}>

export type OrgRolePermissionSnapshot = {
  orgId: string
  roles: ConfigRoleRecord[]
  permissionsEditable: boolean
  modulePermissionCatalog: RoleModulePermissionCatalog
  canAppointSystemSuperAdmin: boolean
  permissionsEditBlockReason: string | null
}

export class RolePermissionRequestError extends Error {
  constructor(message: string, readonly status: number, readonly requiresRefresh = false) {
    super(message)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function permissionList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(permission => typeof permission === 'string' && permission.length > 0)
    && new Set(value).size === value.length
}

function samePermissions(actual: unknown, expected: string[]): boolean {
  return permissionList(actual) && actual.length === expected.length && expected.every(key => actual.includes(key))
}

function parseRole(value: unknown): ConfigRoleRecord | null {
  if (!isObject(value) || typeof value.id !== 'string' || !value.id || typeof value.code !== 'string'
    || typeof value.name !== 'string' || !permissionList(value.permissions)) return null
  return {
    id: value.id,
    code: value.code,
    name: value.name,
    description: typeof value.description === 'string' ? value.description : null,
    permissions: value.permissions,
    sort_order: typeof value.sort_order === 'number' ? value.sort_order : null,
    permissions_edit_block_reason: typeof value.permissions_edit_block_reason === 'string' ? value.permissions_edit_block_reason : null,
    ...(permissionList(value.owner_shipping_permissions) ? { owner_shipping_permissions: value.owner_shipping_permissions } : {}),
  }
}

function parseModuleCatalog(value: unknown): RoleModulePermissionCatalog {
  if (!Array.isArray(value)) return []
  return value.flatMap((group) => {
    if (!isObject(group) || typeof group.id !== 'string' || typeof group.label !== 'string'
      || typeof group.description !== 'string' || !Array.isArray(group.items)) return []
    const items = group.items.flatMap((item) => (
      isObject(item) && item.selectable === true
        && typeof item.key === 'string' && typeof item.label === 'string' && typeof item.description === 'string'
        && permissionList(item.dependencies)
        ? [{ key: item.key, label: item.label, description: item.description, dependencies: item.dependencies }]
        : []
    ))
    return items.length > 0 ? [{ id: group.id, label: group.label, description: group.description, items }] : []
  })
}

async function readData(response: Response, fallback: string): Promise<Record<string, unknown>> {
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const error = isObject(body) ? body.error : null
    const message = typeof error === 'string' ? error : isObject(error) && typeof error.message === 'string' ? error.message : fallback
    throw new RolePermissionRequestError(message, response.status)
  }
  if (!isObject(body) || body.success !== true || !isObject(body.data)) {
    throw new RolePermissionRequestError(fallback, response.status)
  }
  return body.data
}

export async function loadOrgRolePermissionSnapshot(
  headers: HeadersInit,
  roleId?: string,
): Promise<OrgRolePermissionSnapshot> {
  const url = roleId ? `/api/roles?role_id=${encodeURIComponent(roleId)}` : '/api/roles'
  const response = await fetch(url, { headers, cache: 'no-store' })
  const data = await readData(response, '角色权限加载失败，请刷新后重试。')
  const roles = Array.isArray(data.roles) ? data.roles.map(parseRole) : null
  if (typeof data.org_id !== 'string' || !data.org_id || typeof data.permissions_editable !== 'boolean'
    || !roles || roles.some(role => role === null)) {
    throw new RolePermissionRequestError('角色权限响应不完整，请刷新后重试。', response.status)
  }
  return {
    orgId: data.org_id,
    roles: roles.filter((role): role is ConfigRoleRecord => role !== null),
    permissionsEditable: data.permissions_editable,
    modulePermissionCatalog: parseModuleCatalog(data.permission_catalog),
    canAppointSystemSuperAdmin: data.can_appoint_system_super_admin === true,
    permissionsEditBlockReason: typeof data.permissions_edit_block_reason === 'string' ? data.permissions_edit_block_reason : null,
  }
}

export async function saveAndReadOrgRolePermissions(
  headers: HeadersInit,
  input: {
    orgId: string
    roleId: string
    expectedPermissions: string[]
    permissions: string[]
    ownerChange?: { expected: string[]; permissions: string[] }
  },
): Promise<{ role: ConfigRoleRecord; snapshot: OrgRolePermissionSnapshot }> {
  const requestHeaders = new Headers(headers)
  requestHeaders.set('Content-Type', 'application/json')
  const response = await fetch(`/api/roles/${encodeURIComponent(input.roleId)}`, {
    method: 'PATCH',
    headers: requestHeaders,
    body: JSON.stringify({
      expected_org_id: input.orgId,
      expected_permissions: input.expectedPermissions,
      permissions: input.permissions,
      ...(input.ownerChange ? {
        expected_owner_shipping_permissions: input.ownerChange.expected,
        owner_shipping_permissions: input.ownerChange.permissions,
      } : {}),
    }),
  })
  const receipt = await readData(response, '角色权限保存失败，请刷新后重试。')
  const receiptRole = parseRole(receipt.role)
  if (receipt.org_id !== input.orgId || receiptRole?.id !== input.roleId
    || !samePermissions(receiptRole.permissions, input.permissions)
    || (input.ownerChange && !samePermissions(receiptRole.owner_shipping_permissions, input.ownerChange.permissions))) {
    throw new RolePermissionRequestError('无法确认本次保存，请刷新角色列表核实。', response.status, true)
  }

  let snapshot: OrgRolePermissionSnapshot
  try {
    snapshot = await loadOrgRolePermissionSnapshot(headers, input.roleId)
  } catch (error) {
    const status = error instanceof RolePermissionRequestError ? error.status : 0
    throw new RolePermissionRequestError('保存请求已返回成功，暂未核实回读结果。请刷新后核对。', status, true)
  }
  const role = snapshot.roles.length === 1 ? snapshot.roles[0] : null
  if (snapshot.orgId !== input.orgId || role?.id !== input.roleId || !samePermissions(role.permissions, input.permissions)
    || (input.ownerChange && !samePermissions(role.owner_shipping_permissions, input.ownerChange.permissions))) {
    throw new RolePermissionRequestError('回读结果与本次保存不一致，请刷新后核对当前组织权限。', 409, true)
  }
  return { role, snapshot }
}
