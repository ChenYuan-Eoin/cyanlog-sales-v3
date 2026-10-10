import type { NextRequest } from 'next/server'
import { shippingManagerHandler, shippingJson } from '@/lib/shipping/http'
import { loadIntakeSettings, saveIntakeSettings } from '@/lib/shipping/intake-settings'
export const runtime = 'nodejs'
export async function GET(req: NextRequest) { return shippingManagerHandler(req, async (_user, orgId) => ({ rules: await loadIntakeSettings(orgId) })) }
export async function POST(req: NextRequest) { return shippingManagerHandler(req, async (user, orgId) => ({ rules: await saveIntakeSettings(orgId, user.id, await shippingJson(req)) })) }
