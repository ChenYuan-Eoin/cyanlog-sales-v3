// F003 / WP94. Resolve exactly one configured provider without exposing tenant
// selection or credential material to the public login endpoint.
import { supabaseAdmin } from '@/lib/supabase'
import { FxiaokeError } from './contracts'
import { loadOAuthCredentials } from './settings'

// Database seeds use valid UUID text without RFC version/variant bits.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function listConfiguredOAuthOrganizationIds(limit = 2) {
  const { data, error } = await supabaseAdmin
    .from('organization_fxiaoke_connections')
    .select('system_org_id')
    .order('updated_at', { ascending: false })
    .limit(Math.max(1, Math.min(limit, 10)))

  if (error) {
    throw new FxiaokeError('SSO_CONFIGURATION_UNAVAILABLE', '企业登录配置暂时不可用，请稍后重试。', 503)
  }

  const ids = Array.from(new Set((data || []).map(row => row.system_org_id)))
  if (ids.some(id => typeof id !== 'string' || !UUID.test(id))) {
    throw new FxiaokeError('SSO_CONFIGURATION_UNAVAILABLE', '企业登录配置不完整，请联系管理员。', 503)
  }
  return ids as string[]
}

export async function resolveConfiguredOAuthOrganization() {
  const organizationIds = await listConfiguredOAuthOrganizationIds()
  if (organizationIds.length === 0) {
    throw new FxiaokeError('CONFIGURATION_REQUIRED', '尚未配置纷享企业登录，请联系管理员。', 409)
  }
  if (organizationIds.length > 1) {
    throw new FxiaokeError('SSO_ORGANIZATION_AMBIGUOUS', '检测到多个纷享企业登录配置，已拒绝自动选择。', 409)
  }

  const orgId = organizationIds[0]
  return { orgId, credentials: await loadOAuthCredentials(orgId) }
}
