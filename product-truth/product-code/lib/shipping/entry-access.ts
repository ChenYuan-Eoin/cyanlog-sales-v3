import type { AuthUser } from '@/lib/auth'
import { SHIPPING_MANAGE_CONNECTIONS, SHIPPING_OPERATE } from '@/lib/module-access'
import { loadOrgRolePermissionContext } from '@/lib/org-role-permissions'
import { loadPublishedModulePermissionKeys } from '@/lib/permission-registry'
import { hasPermission } from '@/lib/permissions'
import { supabaseAdmin } from '@/lib/supabase'

type PublishedShippingAccess = { orgId: string; permissions: string[] }

async function loadPublishedShippingAccess(userId: string): Promise<PublishedShippingAccess | null> {
  const [context, published] = await Promise.all([
    loadOrgRolePermissionContext(userId), loadPublishedModulePermissionKeys(),
  ])
  if (!context) return null
  return {
    orgId: context.orgId,
    permissions: published.filter(key => hasPermission(context.actorPermissions, key)),
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
  return {
    orgId: access.orgId,
    canOperate: access.permissions.includes(SHIPPING_OPERATE),
    canSubmitOwn: session.data.auth_method === 'fxiaoke' && user.org_id === access.orgId,
    canManageConnections: access.permissions.includes(SHIPPING_MANAGE_CONNECTIONS),
  }
}
