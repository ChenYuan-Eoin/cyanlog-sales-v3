import type { AuthUser } from '@/lib/auth'
import {
  getEffectiveOwnerShippingPermissions, getEffectiveShippingPermissions,
} from '@/lib/module-access'
import { loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import { loadShippingModulePermissionState } from '@/lib/permission-registry'
import { supabaseAdmin } from '@/lib/supabase'

type PublishedShippingAccess = {
  orgId: string
  permissions: string[]
  roleCodes: string[]
  ownerPermissions: string[]
}

export async function loadPublishedShippingAccess(userId: string): Promise<PublishedShippingAccess | null> {
  const [context, publication] = await Promise.all([
    loadCurrentOrganizationRoleAssignments(userId), loadShippingModulePermissionState(),
  ])
  if (!context) return null
  const permissions = context.assignments.flatMap(assignment => assignment.permissions)
  return {
    orgId: context.orgId,
    permissions: getEffectiveShippingPermissions(permissions, publication),
    ownerPermissions: getEffectiveOwnerShippingPermissions(
      context.assignments.flatMap(assignment => assignment.ownerShippingPermissions ?? []), publication,
    ),
    roleCodes: context.assignments.map(assignment => assignment.roleCode),
  }
}

/** The caller has already verified the session and active account for this token. */
async function loadShippingSession(user: AuthUser, token: string | null, currentAccess?: PublishedShippingAccess) {
  if (!token) return null
  const [access, session] = await Promise.all([
    currentAccess ?? loadPublishedShippingAccess(user.id),
    supabaseAdmin.from('auth_tokens').select('user_id,auth_method').eq('token', token)
      .eq('user_id', user.id).maybeSingle(),
  ])
  if (session.error) throw session.error
  if (!access || session.data?.user_id !== user.id) return null
  const ownerPermissions = session.data.auth_method === 'fxiaoke' && user.org_id === access.orgId
    ? access.ownerPermissions : []
  return {
    ...access,
    ownerPermissions,
    canReadLegacyReceipt: ownerPermissions.includes('shipping:owner_view')
      || access.permissions.includes('shipping:ledger_view'),
  }
}

export async function resolveShippingOwnerAccess(user: AuthUser, token: string | null) {
  const access = await loadShippingSession(user, token)
  if (!access) return null
  return {
    orgId: access.orgId,
    ownerPermissions: access.ownerPermissions,
    canReadLegacyReceipt: access.canReadLegacyReceipt,
  }
}

export async function resolveShippingEntry(user: AuthUser, token: string | null, currentAccess?: PublishedShippingAccess) {
  const access = await loadShippingSession(user, token, currentAccess)
  if (!access) return null
  return {
    orgId: access.orgId,
    canOperate: access.permissions.includes('shipping:ledger_view'),
    canViewOwn: access.ownerPermissions.includes('shipping:owner_view'),
    canReadLegacyReceipt: access.canReadLegacyReceipt,
    canSubmitOwn: access.ownerPermissions.includes('shipping:owner_submit'),
    canManageConnections: access.permissions.includes('shipping:settings_view'),
    permissions: access.permissions,
    ownerPermissions: access.ownerPermissions,
  }
}
