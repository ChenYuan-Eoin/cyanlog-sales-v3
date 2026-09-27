import { supabaseAdmin } from '@/lib/supabase'
import { getDefaultOrgId, getOrgPermissions, getUserScopedRoleAssignments } from '@/lib/scoped-access'
import { hasPermission } from '@/lib/permissions'
import { ShippingError } from './config'
import { canImportLegacyShippingConfiguration } from './legacy-configuration-scope'

export const SHIPPING_OPERATOR_PERMISSION = 'shipping:operate'

type OrganizationUser = {
  id: string
  display_name: string | null
  login_enabled: boolean | null
  status: string | null
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function parseLegacyOperatorIds(value = process.env.SHIPPING_ALLOWED_USER_IDS || '') {
  return [...new Set(value.split(',').map((item) => item.trim().toLowerCase()).filter((item) => isUuid(item)))]
}

function legacyImportCompleteForOrg(scope: Record<string, unknown> | null | undefined, orgId: string) {
  const migrated = scope?.legacyAllowlistMigratedOrgIds
  return Array.isArray(migrated) && migrated.includes(orgId)
}

async function getShippingOperatePoint() {
  const { data, error } = await supabaseAdmin.from('permission_points').select('id,scope').eq('code', SHIPPING_OPERATOR_PERMISSION).maybeSingle()
  if (error) throw new ShippingError(503, '寄件操作权限读取失败。')
  return typeof data?.id === 'string' ? { id: data.id as string, scope: data.scope as Record<string, unknown> | null } : null
}

async function ensureShippingOperatePoint() {
  const current = await getShippingOperatePoint()
  if (current) return current
  const { data, error } = await supabaseAdmin.from('permission_points').insert({
    code: SHIPPING_OPERATOR_PERMISSION,
    name: '自助收寄操作',
    description: '允许在组织自助收寄工作台办理获授权的寄件、查件和未揽收取消。',
    scope: { resource: 'shipping', action: 'operate', legacyAllowlistMigratedOrgIds: [] },
  }).select('id,scope').single()
  if (error) {
    // Another manager may have initialized the shared permission point at the same time.
    const afterRace = await getShippingOperatePoint()
    if (afterRace) return afterRace
    throw new ShippingError(503, '寄件操作权限初始化失败。')
  }
  if (typeof data?.id !== 'string') throw new ShippingError(503, '寄件操作权限初始化失败。')
  return { id: data.id as string, scope: data.scope as Record<string, unknown> | null }
}

async function listOrganizationUsers(orgId: string): Promise<OrganizationUser[]> {
  const { data: memberships, error: membershipError } = await supabaseAdmin.from('user_organizations')
    .select('user_id').eq('org_id', orgId)
  if (membershipError) throw new ShippingError(503, '组织成员列表读取失败。')
  const userIds = [...new Set((memberships || []).map((row) => row.user_id).filter((id): id is string => typeof id === 'string'))]
  if (!userIds.length) return []
  const { data, error } = await supabaseAdmin.from('users')
    .select('id,display_name,login_enabled,status').in('id', userIds).order('display_name', { ascending: true })
  if (error) throw new ShippingError(503, '组织成员列表读取失败。')
  return (data || []) as OrganizationUser[]
}

export async function requireShippingOperator(userId: string) {
  const orgId = await getDefaultOrgId(userId)
  if (!orgId) throw new ShippingError(403, '当前账号没有可用的组织寄件授权。')

  const assignments = await getUserScopedRoleAssignments(userId)
  const permissions = getOrgPermissions(assignments, orgId)
  const roleGrant = hasPermission(permissions, SHIPPING_OPERATOR_PERMISSION)
    || hasPermission(permissions, 'shipping:*')
  const point = await getShippingOperatePoint()
  let directGrant = false
  if (point) {
    const { data, error } = await supabaseAdmin.from('user_permission_assignments').select('id')
      .eq('user_id', userId).eq('org_id', orgId).eq('permission_point_id', point.id).maybeSingle()
    if (error) throw new ShippingError(503, '寄件操作授权读取失败。')
    directGrant = Boolean(data)
  }

  if (roleGrant || directGrant) return orgId
  throw new ShippingError(403, '当前账号没有自助收寄操作权限。')
}

export async function loadShippingOperatorAccess(orgId: string) {
  const users = await listOrganizationUsers(orgId)
  const point = await getShippingOperatePoint()
  let operatorIds = new Set<string>()
  if (point) {
    const { data, error } = await supabaseAdmin.from('user_permission_assignments').select('user_id')
      .eq('org_id', orgId).eq('permission_point_id', point.id)
    if (error) throw new ShippingError(503, '寄件操作权限读取失败。')
    operatorIds = new Set((data || []).map((row) => row.user_id).filter((id): id is string => typeof id === 'string'))
  }
  const migrated = legacyImportCompleteForOrg(point?.scope, orgId)
  const canImportLegacy = !migrated && await canImportLegacyShippingConfiguration(orgId)
  const legacySet = new Set(canImportLegacy ? parseLegacyOperatorIds().filter((id) => users.some((user) => user.id === id)) : [])
  return {
    operators: users.map((user) => ({
      id: user.id,
      name: user.display_name || '未设置姓名',
      enabled: user.login_enabled === true && user.status !== 'inactive',
      canOperate: operatorIds.has(user.id),
      grantSource: operatorIds.has(user.id) ? 'database' as const : legacySet.has(user.id) ? 'legacy' as const : 'none' as const,
    })),
    legacyImportAvailable: !migrated && legacySet.size > 0,
    legacyImportCompleted: migrated,
  }
}

export async function listShippingOperatorRecipients() {
  const point = await getShippingOperatePoint()
  const recipients = new Map<string, { userId: string; orgId: string }>()
  if (point) {
    const { data, error } = await supabaseAdmin.from('user_permission_assignments').select('user_id,org_id')
      .eq('permission_point_id', point.id)
    if (error) throw new ShippingError(503, '寄件提醒接收人读取失败。')
    for (const row of data || []) {
      if (typeof row.user_id === 'string' && typeof row.org_id === 'string') recipients.set(`${row.user_id}:${row.org_id}`, { userId: row.user_id, orgId: row.org_id })
    }
  }
  if (!recipients.size) return []
  const userIds = [...new Set([...recipients.values()].map((row) => row.userId))]
  const { data: users, error } = await supabaseAdmin.from('users').select('id,status,login_enabled').in('id', userIds)
  if (error) throw new ShippingError(503, '寄件提醒接收人读取失败。')
  const activeIds = new Set((users || []).filter((user) => user.status === 'active' && user.login_enabled === true).map((user) => user.id))
  return [...recipients.values()].filter((row) => activeIds.has(row.userId))
}

export async function saveShippingOperatorAccess(orgId: string, actorId: string, requestedIds: unknown) {
  if (!Array.isArray(requestedIds) || requestedIds.length > 500 || requestedIds.some((id) => typeof id !== 'string' || !isUuid(id))) {
    throw new ShippingError(400, '寄件操作人员列表格式不正确。')
  }
  const selectedIds = [...new Set(requestedIds as string[])]
  const currentAccess = await loadShippingOperatorAccess(orgId)
  if (currentAccess.legacyImportAvailable) throw new ShippingError(409, '请先将旧操作名单迁入组织权限，再修改寄件人员。')
  const users = await listOrganizationUsers(orgId)
  const eligibleUsers = new Set(users.filter((user) => user.login_enabled === true && user.status !== 'inactive').map((user) => user.id))
  if (selectedIds.some((id) => !eligibleUsers.has(id))) throw new ShippingError(400, '只能授权当前组织内已启用的成员。')

  const point = await ensureShippingOperatePoint()
  const { data: existingRows, error: readError } = await supabaseAdmin.from('user_permission_assignments').select('id,user_id')
    .eq('org_id', orgId).eq('permission_point_id', point.id)
  if (readError) throw new ShippingError(503, '寄件操作权限读取失败。')
  const existing = new Map((existingRows || []).map((row) => [row.user_id as string, row.id as string]))
  const toRevoke = [...existing.entries()].filter(([id]) => !selectedIds.includes(id))
  if (toRevoke.length) {
    const { error } = await supabaseAdmin.from('user_permission_assignments').delete()
      .eq('org_id', orgId).eq('permission_point_id', point.id).in('id', toRevoke.map(([, assignmentId]) => assignmentId))
    if (error) throw new ShippingError(503, '撤销寄件操作授权失败。')
  }
  const toGrant = selectedIds.filter((id) => !existing.has(id)).map((userId) => ({
    user_id: userId, permission_point_id: point.id, org_id: orgId, assigned_by: actorId,
  }))
  if (toGrant.length) {
    const { error } = await supabaseAdmin.from('user_permission_assignments')
    .upsert(toGrant, { onConflict: 'user_id,permission_point_id,org_id', ignoreDuplicates: true })
    if (error) throw new ShippingError(503, '保存寄件操作授权失败。')
  }
  return loadShippingOperatorAccess(orgId)
}

export async function importLegacyShippingOperatorAccess(orgId: string, actorId: string) {
  const currentPoint = await getShippingOperatePoint()
  // Retrying an already imported list must not restore subsequently revoked grants.
  if (legacyImportCompleteForOrg(currentPoint?.scope, orgId)) {
    return { importedCount: 0, ...await loadShippingOperatorAccess(orgId) }
  }
  if (!await canImportLegacyShippingConfiguration(orgId)) {
    throw new ShippingError(403, '无法确认旧寄件名单属于当前组织，请在配置中心手动授权。')
  }
  const legacyIds = parseLegacyOperatorIds()
  if (!legacyIds.length) throw new ShippingError(409, '当前环境没有可迁移的旧寄件操作名单。')
  const users = await listOrganizationUsers(orgId)
  const memberIds = new Set(users.map((user) => user.id))
  const orgLegacyIds = legacyIds.filter((userId) => memberIds.has(userId))
  if (!orgLegacyIds.length) throw new ShippingError(409, '旧寄件名单没有属于当前组织的成员，未迁移任何授权。')
  const eligibleUsers = new Set(users.filter((user) => user.login_enabled === true && user.status !== 'inactive').map((user) => user.id))
  if (orgLegacyIds.some((id) => !eligibleUsers.has(id))) throw new ShippingError(409, '旧寄件名单中当前组织的账号未启用；未迁移任何授权。')

  const point = await ensureShippingOperatePoint()
  const records = orgLegacyIds.map((userId) => ({ user_id: userId, permission_point_id: point.id, org_id: orgId, assigned_by: actorId }))
  const { error } = await supabaseAdmin.from('user_permission_assignments')
    .upsert(records, { onConflict: 'user_id,permission_point_id,org_id', ignoreDuplicates: true })
  if (error) throw new ShippingError(503, '迁移旧寄件操作授权失败。')
  const migratedOrgIds = [...new Set([
    ...(Array.isArray(point.scope?.legacyAllowlistMigratedOrgIds) ? point.scope.legacyAllowlistMigratedOrgIds.filter((id): id is string => typeof id === 'string') : []),
    orgId,
  ])]
  const { error: markerError } = await supabaseAdmin.from('permission_points').update({
    scope: { ...(point.scope || {}), resource: 'shipping', action: 'operate', legacyAllowlistMigratedOrgIds: migratedOrgIds },
  }).eq('id', point.id)
  if (markerError) throw new ShippingError(503, '寄件授权已写入，但旧名单迁移状态保存失败；请重试核验。')
  return { importedCount: records.length, ...await loadShippingOperatorAccess(orgId) }
}
