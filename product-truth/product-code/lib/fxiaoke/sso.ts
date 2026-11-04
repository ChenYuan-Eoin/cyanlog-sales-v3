// F003 / WP94. Resolve exactly one verified provider connection from the shared source ledger.
import { listIdentityAuthoritativeConnectionOrganizationIds } from '@/lib/organization-connections'
import { FxiaokeError } from './contracts'
import { loadOAuthCredentials } from './settings'

// Database seeds use valid UUID text without RFC version/variant bits.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function listConfiguredOAuthOrganizationIds(limit = 2) {
  try {
    const ids = await listIdentityAuthoritativeConnectionOrganizationIds('fxiaoke', limit)
    if (ids.some(id => !UUID.test(id))) {
      throw new FxiaokeError('SSO_CONFIGURATION_UNAVAILABLE', '企业登录配置不完整，请联系管理员。', 503)
    }
    return ids
  } catch (error) {
    if (error instanceof FxiaokeError) throw error
    throw new FxiaokeError('SSO_CONFIGURATION_UNAVAILABLE', '企业登录配置暂时不可用，请稍后重试。', 503)
  }
}

export async function resolveConfiguredOAuthOrganization() {
  const organizationIds = await listConfiguredOAuthOrganizationIds(2)
  if (organizationIds.length === 0) {
    throw new FxiaokeError('CONFIGURATION_REQUIRED', '纷享尚未成为当前组织的身份权威来源，企业登录保持关闭。', 409)
  }
  if (organizationIds.length > 1) {
    throw new FxiaokeError('SSO_ORGANIZATION_AMBIGUOUS', '检测到多个纷享企业登录配置，已拒绝自动选择。', 409)
  }

  const orgId = organizationIds[0]
  return { orgId, credentials: await loadOAuthCredentials(orgId) }
}
