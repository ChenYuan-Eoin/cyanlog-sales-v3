// REQ: F003 / WP50. Fxiaoke supplies only its credential schema and directory protocol.
import { z } from 'zod'
import { previewDirectory, discoverEnterprise } from '@/lib/fxiaoke/client'
import { decryptCredentials } from '@/lib/fxiaoke/crypto'
import { FxiaokeError } from '@/lib/fxiaoke/contracts'
import { transportForOrganization } from '@/lib/fxiaoke/egress/server'
import { OrganizationConnectionError } from '../errors'
import type { AdapterDirectoryRead, AdapterVerification, DirectoryAdapter, OrganizationConnectionAdapter, PreparedConnection } from '../types'

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
  async verifyConnection(credentials, context): Promise<AdapterVerification> {
    const parsed = storedSchema.parse(credentials)
    try {
      const enterprise = await discoverEnterprise(
        { appId: parsed.appId, appSecret: parsed.appSecret, permanentCode: parsed.permanentCode },
        transportForOrganization(context.systemOrgId),
      )
      if (!parsed.expectedEa.startsWith('pending-') && parsed.expectedEa !== enterprise.ea) {
        throw new OrganizationConnectionError('ENTERPRISE_MISMATCH', '应用所属企业与已保存配置不一致，请核对凭据。', 409)
      }
      return {
        checkedAt: new Date().toISOString(),
        externalTenantId: enterprise.ea,
        verifiedTenantIds: [enterprise.ea, enterprise.corpId],
        metadata: { appId: parsed.appId, apiUserId: parsed.apiUserId, expectedEa: enterprise.ea },
        credentialPatch: {
          appId: parsed.appId,
          appSecret: parsed.appSecret,
          permanentCode: parsed.permanentCode,
          expectedEa: enterprise.ea,
          expectedCorpId: enterprise.corpId,
          apiUserId: parsed.apiUserId,
        },
      }
    } catch (error) {
      if (error instanceof OrganizationConnectionError) throw error
      if (error instanceof FxiaokeError) throw new OrganizationConnectionError(error.code, error.message, error.status as OrganizationConnectionError['status'])
      throw new OrganizationConnectionError('CONNECTION_VERIFICATION_FAILED', '纷享应用连接验证失败，请重新检查配置。', 502)
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

/**
 * Fxiaoke directory capability. It shares the connection record and credentials,
 * but is resolved independently from enterprise login and connection verification.
 */
export const fxiaokeDirectoryAdapter: DirectoryAdapter = {
  provider: 'fxiaoke',
  supportsScopeProof: false,
  async readDirectory(credentials, context): Promise<AdapterDirectoryRead> {
    const parsed = storedSchema.parse(credentials)
    try {
      const preview = await previewDirectory(parsed, transportForOrganization(context.systemOrgId))
      return {
        checkedAt: preview.checkedAt,
        complete: preview.complete,
        // Pagination only proves the authorized readable scope was consumed.
        // Fxiaoke has not returned evidence that this employee can read the
        // whole company, so this remains a separate, fail-closed gate.
        scopeVerified: false,
        scopeEvidence: null,
        departments: preview.departments,
        employees: preview.employees,
        warnings: preview.warnings,
      }
    } catch (error) {
      if (error instanceof OrganizationConnectionError) throw error
      if (error instanceof FxiaokeError) throw new OrganizationConnectionError(error.code, error.message, error.status as OrganizationConnectionError['status'])
      throw new OrganizationConnectionError('DIRECTORY_READ_FAILED', '纷享通讯录读取失败，请检查应用通讯录权限。', 502)
    }
  },
  normalizeDirectoryStatus(value) {
    const normalized = value.trim().toLowerCase()
    if (normalized === '0' || ['active', 'enabled'].includes(normalized)) return 'active'
    if (normalized === '1' || ['inactive', 'disabled', 'resigned', 'frozen'].includes(normalized)) return 'inactive'
    if (normalized === '2' || normalized === 'deleted') return 'deleted'
    return 'unknown'
  },
}
