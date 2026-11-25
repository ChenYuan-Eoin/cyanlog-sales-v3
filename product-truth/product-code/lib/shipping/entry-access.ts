import type { AuthUser } from '@/lib/auth'
import { canWriteFxiaokeOwnerShipping, SHIPPING_MANAGE_CONNECTIONS, SHIPPING_OPERATE } from '@/lib/module-access'
import { loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import { loadPublishedModulePermissionKeys } from '@/lib/permission-registry'
import { hasPermission } from '@/lib/permissions'
import { supabaseAdmin } from '@/lib/supabase'

type PublishedShippingAccess = { orgId: string; permissions: string[]; roleCodes: string[] }

export async function loadPublishedShippingAccess(userId: string): Promise<PublishedShippingAccess | null> {
  const [context, published] = await Promise.all([
    loadCurrentOrganizationRoleAssignments(userId), loadPublishedModulePermissionKeys(),
  ])
  if (!context) return null
  const permissions = context.assignments.flatMap(assignment => assignment.permissions)
  return {
    orgId: context.orgId,
    permissions: published.filter(key => hasPermission(permissions, key)),
    roleCodes: context.assignments.map(assignment => assignment.roleCode),
  }
}

/** The caller has already verified the session and active account for this token. */
export async function resolveShippingEntry(
  user: AuthUser,
  token: string | null,
  currentAccess?: PublishedShippingAccess,
) {
  if (!token) return null
  const [access, session] = await Promise.all([
    currentAccess ?? loadPublishedShippingAccess(user.id),
    supabaseAdmin.from('auth_tokens').select('user_id,auth_method').eq('token', token)
      .eq('user_id', user.id).maybeSingle(),
  ])
  if (session.error) throw session.error
  if (!access || session.data?.user_id !== user.id) return null
  const canViewOwn = session.data.auth_method === 'fxiaoke'
    && user.org_id === access.orgId && access.roleCodes.length > 0
  return {
    orgId: access.orgId,
    canOperate: access.permissions.includes(SHIPPING_OPERATE),
    canViewOwn,
    canSubmitOwn: canViewOwn && canWriteFxiaokeOwnerShipping(access.roleCodes),
    canManageConnections: access.permissions.includes(SHIPPING_MANAGE_CONNECTIONS),
  }
}
