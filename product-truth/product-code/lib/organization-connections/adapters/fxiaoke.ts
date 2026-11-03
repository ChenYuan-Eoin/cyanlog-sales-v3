// REQ: F003 / WP50. Fxiaoke supplies only its credential schema and directory protocol.
import { z } from 'zod'
import { previewDirectory, discoverEnterprise } from '@/lib/fxiaoke/client'
import { decryptCredentials } from '@/lib/fxiaoke/crypto'
import { FxiaokeError } from '@/lib/fxiaoke/contracts'
import { transportForOrganization } from '@/lib/fxiaoke/egress/server'
import { OrganizationConnectionError } from '../errors'
import type { AdapterVerification, OrganizationConnectionAdapter, PreparedConnection } from '../types'

const identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const inputSchema = z.object({
  appId: identifier,
  appSecret: z.string().trim().max(512).optional().default(''),
  permanentCode: z.string().trim().max(512).optional().default(''),
  expectedEa: identifier.optional(),
  apiUserId: identifier,
}).strict()
const storedSchema = z.object({
  appId: identifier,
  appSecret: z.string().min(1).max(512),
  permanentCode: z.string().min(1).max(512),
  expectedEa: z.string().trim().min(1).max(128),
  expectedCorpId: z.string().trim().min(1).max(256).optional(),
  apiUserId: identifier,
}).strict()

function invalid(message: string) {
  return new OrganizationConnectionError('INVALID_CONFIGURATION', message, 400)
}

export const fxiaokeConnectionAdapter: OrganizationConnectionAdapter = {
  provider: 'fxiaoke',
  label: '纷享销客',
  previewAvailable: true,
  syncAvailable: false,
  fields: [
    { key: 'appId', label: 'AppID', type: 'text', placeholder: '填写纷享的 AppID', help: '在纷享管理后台对应自建应用的开发模式中复制。', secret: false },
    { key: 'appSecret', label: 'APPSecret', type: 'password', placeholder: '留空将保留同一应用的已保存密钥', help: '首次配置或更换 AppID 时必须填写；密钥只保存在服务端。', secret: true },
    { key: 'permanentCode', label: '永久授权码', type: 'password', placeholder: '留空将保留同一应用的已保存授权码', help: '在对应自建应用的开发模式中复制永久授权码。', secret: true },
    { key: 'apiUserId', label: '员工 ID', type: 'text', placeholder: '填写有通讯录读取权限的员工 ID', help: '系统按该员工及自建应用的实际权限读取通讯录。', secret: false },
  ],
  parseInput(value) {
    const parsed = inputSchema.safeParse(value)
    if (!parsed.success) throw invalid('请填写有效的纷享 AppID、员工 ID 和密钥。')
    return parsed.data
  },
  prepare(input, previous): PreparedConnection {
    const parsed = inputSchema.parse(input)
    const previousAppId = typeof previous?.appId === 'string' ? previous.appId : null
    const sameApp = Boolean(previous && previousAppId === parsed.appId)
    const appSecret = parsed.appSecret || (sameApp && typeof previous?.appSecret === 'string' ? previous.appSecret : '')
    const permanentCode = parsed.permanentCode || (sameApp && typeof previous?.permanentCode === 'string' ? previous.permanentCode : '')
    if (!appSecret || !permanentCode) throw invalid('首次配置或更换 AppID 时，请填写 APPSecret 和永久授权码。')
    const expectedEa = parsed.expectedEa
      || (sameApp && typeof previous?.expectedEa === 'string' ? previous.expectedEa : '')
      || `pending-${parsed.appId}`
    const credentials = {
      appId: parsed.appId,
      appSecret,
      permanentCode,
      expectedEa,
      apiUserId: parsed.apiUserId,
      ...(sameApp && typeof previous?.expectedCorpId === 'string' ? { expectedCorpId: previous.expectedCorpId } : {}),
    }
    return {
      credentials,
      metadata: { appId: parsed.appId, apiUserId: parsed.apiUserId, expectedEa },
      externalTenantId: expectedEa,
    }
  },
  async verify(credentials, context): Promise<AdapterVerification> {
    const parsed = storedSchema.parse(credentials)
    try {
      const enterprise = await discoverEnterprise(
        { appId: parsed.appId, appSecret: parsed.appSecret, permanentCode: parsed.permanentCode },
        transportForOrganization(context.systemOrgId),
      )
      if (!parsed.expectedEa.startsWith('pending-') && parsed.expectedEa !== enterprise.ea) {
        throw new OrganizationConnectionError('ENTERPRISE_MISMATCH', '应用所属企业与已保存配置不一致，请核对凭据。', 409)
      }
      const verifiedCredentials = {
        appId: parsed.appId,
        appSecret: parsed.appSecret,
        permanentCode: parsed.permanentCode,
        expectedEa: enterprise.ea,
        expectedCorpId: enterprise.corpId,
        apiUserId: parsed.apiUserId,
      }
      const preview = await previewDirectory(verifiedCredentials, transportForOrganization(context.systemOrgId))
      return {
        checkedAt: preview.checkedAt,
        externalTenantId: enterprise.ea,
        metadata: { appId: parsed.appId, apiUserId: parsed.apiUserId, expectedEa: enterprise.ea },
        credentialPatch: verifiedCredentials,
        departments: preview.departments,
        employees: preview.employees,
        warnings: preview.warnings,
      }
    } catch (error) {
      if (error instanceof OrganizationConnectionError) throw error
      if (error instanceof FxiaokeError) throw new OrganizationConnectionError(error.code, error.message, error.status as OrganizationConnectionError['status'])
      throw new OrganizationConnectionError('PREVIEW_FAILED', '纷享通讯录预览失败，请重新检查配置。', 502)
    }
  },
  validateStored(credentials) {
    const parsed = storedSchema.safeParse(credentials)
    if (!parsed.success) throw new OrganizationConnectionError('CREDENTIALS_UNREADABLE', '已保存的纷享连接配置不完整，请重新配置。', 503)
    return parsed.data
  },
  decryptLegacy(ciphertext, context) {
    return JSON.parse(decryptCredentials(context.systemOrgId, ciphertext)) as Record<string, unknown>
  },
}
