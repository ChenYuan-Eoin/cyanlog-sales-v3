import { z } from 'zod'
import type { NextRequest } from 'next/server'
import { shippingHandler, shippingJson } from '@/lib/shipping/http'
import { saveFxiaokeCommonSender } from '@/lib/shipping/contacts'
import { contactSchema } from '@/lib/shipping/validation'
import { loadIntakeSettings } from '@/lib/shipping/intake-settings'
import { loadEmployeeShippingDepartments, loadFxiaokeShippingProfile, resolveEmployeeShippingDepartment } from '@/lib/shipping/department-access'

export const runtime = 'nodejs'

const saveSchema = z.object({
  action: z.literal('save_profile'),
  profile: z.object({
    sender: contactSchema,
    team: z.string().max(80).optional(),
    departmentId: z.string().uuid().optional(),
    expectedUpdatedAt: z.string().min(1),
  }).strict(),
}).strict()

export async function GET(req: NextRequest) {
  return shippingHandler(req, async (user, orgId) => {
    const rules = await loadIntakeSettings(orgId)
    return { employee: await loadFxiaokeShippingProfile(user, orgId, rules) }
  }, { allowFxiaokeSelfSubmit: true })
}

export async function POST(req: NextRequest) {
  return shippingHandler(req, async (user, orgId) => {
    const input = saveSchema.parse(await shippingJson(req))
    const rules = await loadIntakeSettings(orgId)
    const departments = await loadEmployeeShippingDepartments(user.id, orgId, rules)
    const selected = resolveEmployeeShippingDepartment(departments, input.profile.departmentId, input.profile.team)
    await saveFxiaokeCommonSender(user, orgId, input.profile.sender, input.profile.expectedUpdatedAt, selected.name, selected.id)
    return { employee: await loadFxiaokeShippingProfile(user, orgId, rules) }
  }, { allowFxiaokeSelfSubmit: true })
}
