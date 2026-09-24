import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth'
import { shippingManagerHandler, shippingJson } from '@/lib/shipping/http'
import {
  loadShippingConfiguration,
  saveBillingAccount,
  saveCarrierCredentials,
  saveDefaultSender,
  updateBillingAccount,
  getSandboxProbeCredentials,
  recordSandboxProbe
} from '@/lib/shipping/connections'
import { probeSfSandbox } from '@/lib/shipping/sf-client'
import { allowedShippingUser, ShippingError } from '@/lib/shipping/config'
import { requireShippingConnectionManager } from '@/lib/shipping/connection-authorization'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    try {
      const orgId = await requireShippingConnectionManager(user.id)
      return NextResponse.json({ configuration: await loadShippingConfiguration(orgId) }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (error) {
      // The sidebar uses this route as a navigation gate. An operator may see
      // the /shipping entry without receiving any connection/account/sender settings.
      if (error instanceof ShippingError && error.status === 403 && allowedShippingUser(user)) {
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
      case 'add_billing_account': return { configuration: await saveBillingAccount(orgId, user.id, input) }
      case 'set_default_account': return { configuration: await updateBillingAccount(orgId, user.id, String(input.accountId || ''), 'default') }
      case 'deactivate_account': return { configuration: await updateBillingAccount(orgId, user.id, String(input.accountId || ''), 'deactivate') }
      case 'save_sender': return { configuration: await saveDefaultSender(orgId, user.id, input) }
      case 'test_sandbox_connection': {
        const credentials = await getSandboxProbeCredentials(orgId)
        const result = await probeSfSandbox(credentials.partnerId, credentials.checkWord)
        const configuration = await recordSandboxProbe(orgId, credentials.id, result.connected)
        return { configuration, probe: result }
      }
      default: throw new ShippingError(400, '不支持的寄件配置操作。')
    }
  })
}
