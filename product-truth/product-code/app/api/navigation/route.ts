import { type NextRequest, NextResponse } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth'
import { getRequestAuthToken } from '@/lib/auth-token'
import { resolveShippingEntry } from '@/lib/shipping/entry-access'

const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const shipping = await resolveShippingEntry(user, getRequestAuthToken(req))
    if (!shipping) return NextResponse.json({ paths: [] }, { status: 403, headers })
    const paths: string[] = []
    if (shipping.canOperate || shipping.canViewOwn || shipping.departmentLedger?.length) paths.push('/shipping')
    if (shipping.canManageConnections) paths.push('/shipping/settings')
    return NextResponse.json({ paths }, { headers })
  } catch (error) {
    return NextResponse.json({ paths: [] }, { status: error instanceof AuthError ? 401 : 503, headers })
  }
}
