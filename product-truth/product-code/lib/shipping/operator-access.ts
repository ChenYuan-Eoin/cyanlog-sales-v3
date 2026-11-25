import { getEffectiveShippingPermissions, SHIPPING_OPERATE, type ShippingPermissionKey } from '@/lib/module-access'
import { loadShippingModulePermissionState } from '@/lib/permission-registry'
import { resolveRolePermissions } from '@/lib/role-permission-resolution'
import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'
import { loadPublishedShippingAccess } from './entry-access'

const REMINDER_PAGE_SIZE = 500

type OperatorRecipient = { userId: string; orgId: string }
type RecipientAssignment = {
  user_id: string
  org_id: string
  scope_type: string
  scope_id: string | null
  role: { id: string; code: string; name: string; permissions: unknown } | null
  user: { id: string; status: string; login_enabled: boolean | null } | null
  membership: {
    user_id: string
    org_id: string
    status: string
    employment_status: string
    is_default: boolean
    left_at: string | null
    organization: { id: string; status: string; settings: unknown } | null
  } | null
}

export async function loadShippingOperatorDecision(userId: string, permission: ShippingPermissionKey = SHIPPING_OPERATE): Promise<{ orgId: string; canOperate: boolean; roleCodes: string[] } | null> {
  try {
    const access = await loadPublishedShippingAccess(userId)
    if (!access) return null
    return {
      orgId: access.orgId,
      roleCodes: access.roleCodes,
      canOperate: access.permissions.includes(permission),
    }
  } catch {
    throw new ShippingError(503, '寄件操作授权读取失败。')
  }
}

export async function requireShippingOperator(userId: string, permission: ShippingPermissionKey = SHIPPING_OPERATE) {
  const decision = await loadShippingOperatorDecision(userId, permission)
  if (!decision?.canOperate) throw new ShippingError(403, '当前账号没有自助收寄操作权限。')
  return decision.orgId
}

function getOperatorRecipient(
  assignment: RecipientAssignment, publication: Awaited<ReturnType<typeof loadShippingModulePermissionState>>,
): OperatorRecipient | null {
  const { user_id: userId, org_id: orgId, membership, user, role } = assignment
  if (!userId || !orgId || assignment.scope_type !== 'org' || assignment.scope_id !== orgId
    || user?.id !== userId || user.status !== 'active' || user.login_enabled !== true
    || membership?.user_id !== userId || membership.org_id !== orgId || membership.status !== 'active'
    || membership.employment_status !== 'active' || membership.is_default !== true || membership.left_at !== null
    || membership.organization?.id !== orgId || membership.organization.status !== 'active'
    || !role?.id || !role.code || !role.name) return null

  const { permissions } = resolveRolePermissions(membership.organization.settings, role)
  // Workbench access can inherit platform authority. Reminders go to explicitly assigned shipping operators.
  const operatorGrants = permissions.filter(permission => permission !== '*')
  if (!getEffectiveShippingPermissions(operatorGrants, publication).includes('shipping:record_review')) return null
  return { userId, orgId }
}

export async function listShippingOperatorRecipients() {
  try {
    const publication = await loadShippingModulePermissionState()
    if (!publication.published.has(SHIPPING_OPERATE) && !publication.published.has('shipping:record_review')) return []

    const recipients = new Map<string, OperatorRecipient>()
    for (let offset = 0; ; offset += REMINDER_PAGE_SIZE) {
      const { data, error } = await supabaseAdmin.from('user_roles')
        .select(`user_id,org_id,scope_type,scope_id,
          role:roles!user_roles_role_id_fkey(id,code,name,permissions),
          user:users!user_roles_user_id_fkey!inner(id,status,login_enabled),
          membership:user_organizations!user_roles_org_user_membership_fk!inner(
            user_id,org_id,status,employment_status,is_default,left_at,
            organization:organizations!user_organizations_org_id_fkey!inner(id,status,settings)
          )`)
        .eq('scope_type', 'org')
        .eq('user.status', 'active').eq('user.login_enabled', true)
        .eq('membership.status', 'active').eq('membership.employment_status', 'active')
        .eq('membership.is_default', true).is('membership.left_at', null)
        .eq('membership.organization.status', 'active')
        .order('user_id').order('role_id').order('scope_id')
        .range(offset, offset + REMINDER_PAGE_SIZE - 1)
      if (error || !data) throw error ?? new Error('Missing shipping recipient assignments')

      for (const assignment of data as unknown as RecipientAssignment[]) {
        const recipient = getOperatorRecipient(assignment, publication)
        if (recipient) recipients.set(`${recipient.userId}:${recipient.orgId}`, recipient)
      }
      if (data.length < REMINDER_PAGE_SIZE) return [...recipients.values()]
    }
  } catch {
    throw new ShippingError(503, '寄件提醒接收人读取失败。')
  }
}
