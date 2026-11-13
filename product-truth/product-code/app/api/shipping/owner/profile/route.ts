import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { loadFxiaokeSenderChoices, saveFxiaokeCommonSender } from '@/lib/shipping/contacts'
import { contactSchema } from '@/lib/shipping/validation'

export const runtime = 'nodejs'

const saveSchema = z.object({
  action: z.literal('save_profile'),
  profile: z.object({
    sender: contactSchema,
    team: z.string().max(80).optional(),
    expectedUpdatedAt: z.string().min(1),
  }).strict(),
}).strict()

export async function GET(req: NextRequest) {
  return shippingHandler(req, async (user, orgId) => ({
    employee: await loadFxiaokeSenderChoices(user, orgId),
  }), { allowFxiaokeSelfSubmit: true })
}

export async function POST(req: NextRequest) {
  return shippingHandler(req, async (user, orgId) => {
    const input = saveSchema.parse(await shippingJson(req))
    const employee = await saveFxiaokeCommonSender(user, orgId, input.profile.sender, input.profile.expectedUpdatedAt, input.profile.team)
    return { employee }
  }, { allowFxiaokeSelfSubmit: true })
}
