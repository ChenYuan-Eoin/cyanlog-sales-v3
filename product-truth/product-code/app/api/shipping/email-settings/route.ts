import type { NextRequest } from 'next/server'
import { z } from 'zod'
import { shippingJson, shippingManagerHandler } from '@/lib/shipping/http'
import { loadCompanyEmailSettings, probeCompanyEmailSettings, saveCompanyEmailSettings } from '@/lib/shipping/company-email-settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  return shippingManagerHandler(req, async (_user, orgId) => ({ settings: await loadCompanyEmailSettings(orgId) }))
}

export async function POST(req: NextRequest) {
  return shippingManagerHandler(req, async (user, orgId) => {
    const command = z.discriminatedUnion('action', [
      z.object({ action: z.literal('save'), settings: z.unknown() }).strict(),
      z.object({ action: z.literal('test_connection') }).strict(),
    ]).parse(await shippingJson(req))
    if (command.action === 'test_connection') return probeCompanyEmailSettings(orgId)
    return { settings: await saveCompanyEmailSettings(orgId, user.id, command.settings) }
  })
}
