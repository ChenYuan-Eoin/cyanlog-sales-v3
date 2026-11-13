import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export const runtime = 'nodejs'

// New shipments use the authenticated, owner-bound endpoint. Old clients
// must not silently create anonymous work orders after the access change.
function retired() {
  return NextResponse.json(
    { error: '请登录 ICU 后从自助收寄重新提报。', code: 'AUTHENTICATED_INTAKE_REQUIRED' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function GET() { return retired() }
export async function POST(_req: NextRequest) { return retired() }
