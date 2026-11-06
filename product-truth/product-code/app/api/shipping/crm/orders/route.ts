import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import {
  CrmIntakeError,
  authenticateCrmRequest,
  createCrmIntake,
  readCrmRequestBody,
} from '@/lib/shipping/crm-intake'

export const runtime = 'nodejs'

function errorResponse(error: unknown) {
  if (error instanceof CrmIntakeError) {
    return NextResponse.json({ error: error.message, code: error.code, ...(error.missing ? { missing: error.missing } : {}) }, { status: error.status, headers: { 'Cache-Control': 'no-store' } })
  }
  return NextResponse.json({ error: 'CRM 寄件单暂未受理。', code: 'CRM_INTAKE_FAILED' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await readCrmRequestBody(req)
    const client = authenticateCrmRequest({ method: req.method, pathname: req.nextUrl.pathname, headers: req.headers, rawBody })
    const result = await createCrmIntake(client, rawBody)
    return NextResponse.json(result, { status: 202, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return errorResponse(error)
  }
}
