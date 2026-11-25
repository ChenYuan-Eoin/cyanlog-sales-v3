import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { loadShippingWorkspaceSettings } from '@/lib/shipping/workspace-settings'
import { AuthError, requireAuth } from '@/lib/auth'
import { getRequestAuthToken } from '@/lib/auth-token'
import { resolveShippingEntry } from '@/lib/shipping/entry-access'
import { shippingManagerHandler, shippingJson } from '@/lib/shipping/http'
import {
  loadShippingConfiguration,
  hasLegacyShippingConfiguration,
  importLegacyShippingConfiguration,
  saveBillingAccount,
  saveCarrierCredentials,
  saveAuthorizedServices,
  enableSfInterceptAccess,
  saveDefaultSender,
  updateBillingAccount,
  getConnectionProbeCredentials,
  recordConnectionProbe
} from '@/lib/shipping/connections'
import { canImportLegacyShippingConfiguration } from '@/lib/shipping/legacy-configuration-scope'
import { probeSfConnection } from '@/lib/shipping/sf-client'
import { ShippingError } from '@/lib/shipping/config'
import { checkShippingConnectionAccess, loadShippingConnectionAccess } from '@/lib/shipping/connection-authorization'
import { shippingSettingsWritePermission, type ShippingPermissionKey } from '@/lib/module-access'
export const runtime = 'nodejs'

const LEGACY_IMPORT_PERMISSIONS = [
  'shipping:manage_connections', 'shipping:connection_write', 'shipping:billing_write', 'shipping:intake_write',
] as const satisfies readonly ShippingPermissionKey[]

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    if (req.nextUrl.searchParams.get('workspace') === '1') {
      const access = await resolveShippingEntry(user, getRequestAuthToken(req))
      if (!access?.canOperate) throw new ShippingError(403, '当前账号没有自助收寄操作权限。')
      const settings = await loadShippingWorkspaceSettings(access.orgId)
      return NextResponse.json({
        settings: { ...settings, canOperate: true, canViewOwn: access.canViewOwn, canManageConnections: access.canManageConnections, permissions: access.permissions },
      }, { headers: { 'Cache-Control': 'no-store' } })
    }
    const { orgId, permissions } = await loadShippingConnectionAccess(user.id)
    checkShippingConnectionAccess(permissions, 'shipping:settings_view')
    const configuration = await loadShippingConfiguration(orgId)
    const legacy = { sandbox: hasLegacyShippingConfiguration('sandbox', configuration), production: hasLegacyShippingConfiguration('production', configuration) }
    const legacyAllowed = LEGACY_IMPORT_PERMISSIONS.every(permission => permissions.includes(permission))
      && (legacy.sandbox || legacy.production) && await canImportLegacyShippingConfiguration(orgId)
    return NextResponse.json({
      permissions,
      deploymentEnvironment: ['production', 'preview', 'development'].includes(process.env.VERCEL_ENV || '') ? process.env.VERCEL_ENV : 'unknown',
      credentialStorageReady: /^[a-fA-F0-9]{64}$/.test(process.env.SHIPPING_CREDENTIALS_ENCRYPTION_KEY || ''),
      configuration,
      legacyConfigurationAvailable: {
        sandbox: Boolean(legacyAllowed && legacy.sandbox),
        production: Boolean(legacyAllowed && legacy.production),
      },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const status = error instanceof AuthError ? 401 : error instanceof ShippingError ? error.status : 500
    const message = error instanceof AuthError ? '请先登录。' : error instanceof ShippingError ? error.message : '寄件配置读取失败。'
    return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
  }
}

export async function POST(req: NextRequest) {
  type SettingsBody = { action?: string; [key: string]: unknown }
  let body: SettingsBody
  return shippingManagerHandler(req, async (user, orgId) => {
    const { action, ...input } = body
    switch (action) {
      case 'save_connection': return { configuration: await saveCarrierCredentials(orgId, user.id, input) }
      case 'save_authorized_services': return { configuration: await saveAuthorizedServices(orgId, user.id, input) }
      case 'enable_sf_intercept_access': {
        await enableSfInterceptAccess(orgId, user.id, input)
        return { configuration: await loadShippingConfiguration(orgId) }
      }
      case 'add_billing_account': return { configuration: await saveBillingAccount(orgId, user.id, input) }
      case 'set_default_account': return { configuration: await updateBillingAccount(orgId, user.id, String(input.accountId || ''), 'default') }
      case 'deactivate_account': return { configuration: await updateBillingAccount(orgId, user.id, String(input.accountId || ''), 'deactivate') }
      case 'save_sender': return { configuration: await saveDefaultSender(orgId, user.id, input) }
      case 'import_legacy_configuration': {
        const environment = input.environment
        if (environment !== 'sandbox' && environment !== 'production') throw new ShippingError(400, '请选择要迁入的顺丰运行环境。')
        const result = await importLegacyShippingConfiguration(orgId, user.id, environment)
        return {
          ...result,
          legacyConfigurationAvailable: {
            sandbox: hasLegacyShippingConfiguration('sandbox', result.configuration),
            production: hasLegacyShippingConfiguration('production', result.configuration),
          },
        }
      }
      case 'save_operator_access':
      case 'import_legacy_operator_access':
        throw new ShippingError(410, '寄件操作人员请在“组织与权限”中通过角色管理，当前页面不再分配操作员。')
      case 'test_sandbox_connection':
      case 'test_production_connection': {
        const environment = action === 'test_sandbox_connection' ? 'sandbox' : 'production'
        const credentials = await getConnectionProbeCredentials(orgId, environment)
        const result = await probeSfConnection(environment, credentials.partnerId, credentials.checkWord)
        const configuration = await recordConnectionProbe(orgId, credentials.id, result)
        return { configuration, probe: result }
      }
      default: throw new ShippingError(400, '不支持的寄件配置操作。')
    }
  }, async () => {
    const parsed = await shippingJson(req)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new ShippingError(400, '请核对寄件配置信息。')
    body = parsed as SettingsBody
    const permission = shippingSettingsWritePermission(body.action)
    if (!permission) throw new ShippingError(400, '不支持的寄件配置操作。')
    if (body.action === 'import_legacy_configuration') return LEGACY_IMPORT_PERMISSIONS
    const required: ShippingPermissionKey[] = [permission]
    if (body.action === 'save_connection' && Object.hasOwn(body, 'services')) required.push('shipping:billing_write')
    return required
  })
}
