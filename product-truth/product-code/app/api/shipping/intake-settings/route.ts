import type { NextRequest } from 'next/server'
import { shippingManagerHandler, shippingJson } from '@/lib/shipping/http'
import { loadIntakeSettings, saveIntakeSettings } from '@/lib/shipping/intake-settings'
import { loadShippingDepartments } from '@/lib/shipping/department-access'
import { effectiveShippingDepartmentIds } from '@/lib/shipping/intake-rules'
export const runtime = 'nodejs'
async function reply(orgId: string, rules: Awaited<ReturnType<typeof loadIntakeSettings>>) {
  const departments = await loadShippingDepartments(orgId)
  return { rules, departments, effectiveDepartmentCount: effectiveShippingDepartmentIds(departments, rules.allowedDepartmentIds).size }
}
export async function GET(req: NextRequest) { return shippingManagerHandler(req, async (_user, orgId) => reply(orgId, await loadIntakeSettings(orgId))) }
export async function POST(req: NextRequest) { return shippingManagerHandler(req, async (user, orgId) => reply(orgId, await saveIntakeSettings(orgId, user.id, await shippingJson(req)))) }
