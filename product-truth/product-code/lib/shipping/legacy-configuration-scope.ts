import { supabaseAdmin } from '@/lib/supabase'
import { ShippingError } from './config'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Deployment-wide legacy secrets can only belong to one provable organization. */
export async function canImportLegacyShippingConfiguration(
  orgId: string,
  env: Record<string, string | undefined> = process.env,
): Promise<boolean> {
  const entries = (env.SHIPPING_ALLOWED_USER_IDS || '').split(',').map((value) => value.trim()).filter(Boolean)
  if (!orgId || !entries.length || entries.some((value) => !uuidPattern.test(value))) return false
  const userIds = [...new Set(entries.map((value) => value.toLowerCase()))]

  try {
    // Read every membership, not just memberships in the caller's organization.
    // Exact counts prevent a truncated REST result from proving false uniqueness.
    const [users, memberships] = await Promise.all([
      supabaseAdmin.from('users').select('id,org_id', { count: 'exact' }).in('id', userIds),
      supabaseAdmin.from('user_organizations').select('user_id,org_id', { count: 'exact' }).in('user_id', userIds),
    ])
    if (users.error || memberships.error) throw new Error('Organization lookup failed')
    if (!users.data || !memberships.data || users.count !== users.data.length || memberships.count !== memberships.data.length) return false
    if (users.data.length !== userIds.length) return false

    const organizations = new Map<string, Set<string>>()
    for (const row of users.data) {
      if (typeof row.id !== 'string' || !userIds.includes(row.id) || organizations.has(row.id)) return false
      organizations.set(row.id, new Set(typeof row.org_id === 'string' && row.org_id ? [row.org_id] : []))
    }
    for (const row of memberships.data) {
      if (typeof row.user_id !== 'string' || typeof row.org_id !== 'string' || !row.org_id) return false
      const userOrganizations = organizations.get(row.user_id)
      if (!userOrganizations) return false
      userOrganizations.add(row.org_id)
    }
    return userIds.every((userId) => {
      const userOrganizations = organizations.get(userId)
      return userOrganizations?.size === 1 && userOrganizations.has(orgId)
    })
  } catch {
    throw new ShippingError(503, '旧寄件配置所属组织核验失败，请稍后重试。')
  }
}
