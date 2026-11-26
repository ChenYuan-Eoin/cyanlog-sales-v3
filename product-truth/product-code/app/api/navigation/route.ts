import { type NextRequest, NextResponse } from 'next/server'
import { AuthError, requireAuth } from '@/lib/auth'
import { getRequestAuthToken } from '@/lib/auth-token'
import { hasConfigsTabAccess, readConfigsTabAccess } from '@/lib/configs/tab-access'
import { resolveShippingEntry } from '@/lib/shipping/entry-access'

const headers = { 'Cache-Control': 'private, no-store' }

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    // Middleware overwrites this hint from the verified current organization.
    const scope = req.headers.get('x-user-navigation-scope')
    if (scope === 'department-workbench') {
      return NextResponse.json({ paths: ['/'], onlyProjectedPaths: true }, { headers })
    }

    const shipping = await resolveShippingEntry(user, getRequestAuthToken(req))
    if (!shipping) return NextResponse.json({ paths: [] }, { status: 403, headers })

    if (scope === 'department-ledger' || scope === 'workbench-and-ledger') {
      const paths: string[] = []
      if (scope === 'workbench-and-ledger') paths.push('/')
      if (shipping.departmentLedger?.length) paths.push('/shipping')
      return NextResponse.json({ paths, onlyProjectedPaths: true }, { headers })
    }

    const paths: string[] = []
    if (shipping.canOperate || shipping.canViewOwn || shipping.departmentLedger?.length) paths.push('/shipping')
    if (shipping.canManageConnections) paths.push('/shipping/settings')
    if (hasConfigsTabAccess(readConfigsTabAccess(req.headers, shipping.canManageConnections))) paths.push('/configs')
    return NextResponse.json({ paths, ...(scope === 'shipping-only' ? { onlyProjectedPaths: true } : {}) }, { headers })
  } catch (error) {
    return NextResponse.json({ paths: [] }, { status: error instanceof AuthError ? 401 : 503, headers })
  }
}
