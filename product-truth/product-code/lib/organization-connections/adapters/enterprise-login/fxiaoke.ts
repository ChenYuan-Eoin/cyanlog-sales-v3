// F003 / WP92. Fxiaoke implements only the enterprise-login protocol seam.
import { z } from 'zod'
import { transportForOrganization } from '@/lib/fxiaoke/egress/server'
import { buildFxiaokeAuthorizationUrl, exchangeFxiaokeAuthorizationCode } from '@/lib/fxiaoke/oauth'
import { OrganizationConnectionError } from '../../errors'
import type { EnterpriseLoginAdapter } from '../../types'

const identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const appCredentialsSchema = z.object({
  appId: identifier,
  appSecret: z.string().min(1).max(512),
}).passthrough()
const verifiedCredentialsSchema = appCredentialsSchema.extend({
  expectedEa: identifier,
  expectedCorpId: z.string().trim().min(1).max(255),
})

function invalidCredentials() {
  return new OrganizationConnectionError(
    'CREDENTIALS_UNREADABLE',
    '已保存的纷享连接配置不能用于企业登录，请重新验证连接。',
    503,
  )
}

function parseAppCredentials(credentials: Record<string, unknown>) {
  const parsed = appCredentialsSchema.safeParse(credentials)
  if (!parsed.success) throw invalidCredentials()
  return parsed.data
}

function parseVerifiedCredentials(credentials: Record<string, unknown>) {
  const parsed = verifiedCredentialsSchema.safeParse(credentials)
  if (!parsed.success) throw invalidCredentials()
  return parsed.data
}

export const fxiaokeEnterpriseLoginAdapter: EnterpriseLoginAdapter = {
  provider: 'fxiaoke',
  beginAuthorization(credentials, input) {
    const parsed = parseAppCredentials(credentials)
    return {
      authorizationUrl: buildFxiaokeAuthorizationUrl({
        appId: parsed.appId,
        redirectUrl: input.redirectUrl,
        state: input.state,
      }).toString(),
    }
  },
  async completeAuthorization(credentials, input, context) {
    if (input.providerError) return { status: 'denied' }
    const parsed = parseVerifiedCredentials(credentials)
    const identity = await exchangeFxiaokeAuthorizationCode(parsed, {
      code: input.code || '',
      redirectUrl: input.redirectUrl,
    }, transportForOrganization(context.systemOrgId))
    if (identity.corpId !== parsed.expectedCorpId) {
      throw new OrganizationConnectionError(
        'ENTERPRISE_MISMATCH',
        '纷享登录身份不属于已保存的连接企业。',
        403,
      )
    }
    return {
      status: 'authenticated',
      connectionExternalTenantId: parsed.expectedEa,
      externalUserId: identity.openUserId,
    }
  },
}
