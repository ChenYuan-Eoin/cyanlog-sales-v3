import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { employeeHandler } from '@/lib/shipping/employee-http'
import { shippingJson } from '@/lib/shipping/http'
import { employeePublicProfile, getShippingEmployeeSession, requestEmployeeEmailCode, requireShippingEmployee, revokeShippingEmployeeSession, saveShippingEmployeeProfile, verifyEmployeeEmailCode } from '@/lib/shipping/company-email-access'
import { EMPLOYEE_SESSION_COOKIE, EMPLOYEE_SESSION_MAX_AGE_SECONDS } from '@/lib/shipping/company-email'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request_code'), email: z.string().max(254) }).strict(),
  z.object({ action: z.literal('verify_code'), email: z.string().max(254), challengeId: z.uuid(), code: z.string().regex(/^\d{6}$/) }).strict(),
  z.object({ action: z.literal('save_profile'), profile: z.unknown() }).strict(),
  z.object({ action: z.literal('logout') }).strict(),
])
const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api/shipping/public' }

export async function GET(req: NextRequest) {
  return employeeHandler(req, async () => {
    const session = await getShippingEmployeeSession(req)
    return NextResponse.json({ employee: session ? employeePublicProfile(session.employee) : null })
  })
}

export async function POST(req: NextRequest) {
  return employeeHandler(req, async () => {
    const input = actionSchema.parse(await shippingJson(req))
    if (input.action === 'request_code') return NextResponse.json(await requestEmployeeEmailCode(req, input.email))
    if (input.action === 'verify_code') {
      const { email, challengeId, code } = input
      const result = await verifyEmployeeEmailCode({ email, challengeId, code })
      const response = NextResponse.json({ employee: employeePublicProfile(result.employee) })
      response.cookies.set(EMPLOYEE_SESSION_COOKIE, result.sessionToken, { ...cookieOptions, maxAge: EMPLOYEE_SESSION_MAX_AGE_SECONDS })
      return response
    }
    if (input.action === 'save_profile') {
      const session = await requireShippingEmployee(req)
      const employee = await saveShippingEmployeeProfile(session, input.profile)
      return NextResponse.json({ employee: employeePublicProfile(employee) })
    }
    await revokeShippingEmployeeSession(req)
    const response = NextResponse.json({ employee: null })
    response.cookies.set(EMPLOYEE_SESSION_COOKIE, '', { ...cookieOptions, maxAge: 0 })
    return response
  })
}
