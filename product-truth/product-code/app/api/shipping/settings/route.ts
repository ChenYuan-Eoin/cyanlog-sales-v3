import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth'
import { shippingManagerHandler, shippingJson } from '@/lib/shipping/http'
import {
  loadShippingConfiguration,
  hasLegacyShippingConfiguration,
  importLegacyShippingConfiguration,
  saveBillingAccount,
  saveCarrierCredentials,
  saveAuthorizedServices,
  saveDefaultSender,
  updateBillingAccount,
  getConnectionProbeCredentials,
  recordConnectionProbe
} from '@/lib/shipping/connections'
import { canImportLegacyShippingConfiguration } from '@/lib/shipping/legacy-configuration-scope'
import { probeSfConnection } from '@/lib/shipping/sf-client'
import { ShippingError } from '@/lib/shipping/config'
import { requireShippingConnectionManager } from '@/lib/shipping/connection-authorization'
import { requireShippingOperator, loadShippingOperatorAccess, saveShippingOperatorAccess, importLegacyShippingOperatorAccess } from '@/lib/shipping/operator-access'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    try {
      const orgId = await requireShippingConnectionManager(user.id)
      const [configuration, operatorAccess] = await Promise.all([loadShippingConfiguration(orgId), loadShippingOperatorAccess(orgId)])
      const legacy = { sandbox: hasLegacyShippingConfiguration('sandbox', configuration), production: hasLegacyShippingConfiguration('production', configuration) }
      const legacyAllowed = (legacy.sandbox || legacy.production) && await canImportLegacyShippingConfiguration(orgId)
      return NextResponse.json({
        configuration,
        operatorAccess,
        legacyConfigurationAvailable: {
          sandbox: Boolean(legacyAllowed && legacy.sandbox),
          production: Boolean(legacyAllowed && legacy.production),
        },
      }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      // The sidebar uses this route as a navigation gate. An operator may see
      // the /shipping entry without receiving any connection/account/sender settings.
      if (error instanceof ShippingError && error.status === 403) {
        await requireShippingOperator(user.id)
        return NextResponse.json({ navigationAvailable: true }, { headers: { 'Cache-Control': 'no-store' } })
      }
      throw error
    }
  } catch (error) {
    const status = error instanceof AuthError ? 401 : error instanceof ShippingError ? error.status : 500
    const message = error instanceof AuthError ? '请先登录。' : error instanceof ShippingError ? error.message : '寄件配置读取失败。'
    return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } })
  }
}

export async function POST(req: NextRequest) {
  return shippingManagerHandler(req, async (user, orgId) => {
    const body = await shippingJson(req) as { action?: string; [key: string]: unknown }
    const { action, ...input } = body
    switch (action) {
      case 'save_connection': return { configuration: await saveCarrierCredentials(orgId, user.id, input) }
      case 'save_authorized_services': return { configuration: await saveAuthorizedServices(orgId, user.id, input) }
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
          operatorAccess: await loadShippingOperatorAccess(orgId),
          legacyConfigurationAvailable: {
            sandbox: hasLegacyShippingConfiguration('sandbox', result.configuration),
            production: hasLegacyShippingConfiguration('production', result.configuration),
          },
        }
      }
      case 'save_operator_access': return { operatorAccess: await saveShippingOperatorAccess(orgId, user.id, input.userIds) }
      case 'import_legacy_operator_access': {
        const result = await importLegacyShippingOperatorAccess(orgId, user.id)
        const { importedCount, ...operatorAccess } = result
        return { importedCount, operatorAccess }
      }
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
  })
}
