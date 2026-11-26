import type { NextRequest } from 'next/server'
import { shippingManagerHandler, shippingJson } from '@/lib/shipping/http'
import { loadIntakeSettings, saveIntakeSettings } from '@/lib/shipping/intake-settings'
import type { IntakeRules } from '@/lib/shipping/intake-rules'

export const runtime = 'nodejs'

function fieldSettings({ companyName, team, teamOptions }: IntakeRules) {
  return { rules: { companyName, team, teamOptions } }
}

export async function GET(req: NextRequest) {
  return shippingManagerHandler(req, async (_user, orgId) => fieldSettings(await loadIntakeSettings(orgId)))
}

export async function POST(req: NextRequest) {
  return shippingManagerHandler(req, async (user, orgId) => fieldSettings(
    await saveIntakeSettings(orgId, user.id, await shippingJson(req)),
  ))
}
