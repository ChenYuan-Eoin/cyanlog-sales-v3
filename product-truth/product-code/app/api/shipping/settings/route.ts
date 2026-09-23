import type { NextRequest } from 'next/server'
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
import { ShippingError } from '@/lib/shipping/config'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  return shippingManagerHandler(req, async (_user, orgId) => {
    return { configuration: await loadShippingConfiguration(orgId) }
  })
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
