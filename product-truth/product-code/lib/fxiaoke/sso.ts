// F003 / WP94. Resolve exactly one verified provider connection from the shared source ledger.
import { listIdentityLoginConnections } from '@/lib/organization-connections'
import { FxiaokeError, type Credentials } from './contracts'

// Database seeds use valid UUID text without RFC version/variant bits.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function readLoginConnections(limit: number) {
  try {
    const connections = await listIdentityLoginConnections('fxiaoke', limit)
    if (connections.some(c => !UUID.test(c.orgId))) {
      throw new FxiaokeError('SSO_CONFIGURATION_UNAVAILABLE', '企业登录配置不完整，请联系管理员。', 503)
    }
    return connections
  } catch (error) {
    if (error instanceof FxiaokeError) throw error
    throw new FxiaokeError('SSO_CONFIGURATION_UNAVAILABLE', '企业登录配置暂时不可用，请稍后重试。', 503)
  }
}

export async function listConfiguredOAuthOrganizationIds(limit = 2) {
  return (await readLoginConnections(limit)).map(c => c.orgId)
}

export async function resolveConfiguredOAuthOrganization() {
  const connections = await readLoginConnections(2)
  if (connections.length === 0) {
    throw new FxiaokeError('CONFIGURATION_REQUIRED', '纷享尚未成为当前组织的身份权威来源，企业登录保持关闭。', 409)
  }
  if (connections.length > 1) {
    throw new FxiaokeError('SSO_ORGANIZATION_AMBIGUOUS', '检测到多个纷享企业登录配置，已拒绝自动选择。', 409)
  }

  const connection = connections[0]
  try {
    const credentials = await connection.readCredentials()
    return { orgId: connection.orgId, credentials: credentials as unknown as Credentials }
  } catch {
    throw new FxiaokeError('CREDENTIALS_UNREADABLE', '纷享企业登录配置暂时无法读取。', 503)
  }
}
