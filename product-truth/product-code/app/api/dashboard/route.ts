import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { DashboardDataError, getDashboardPayload } from '@/lib/dashboard-data'

export const preferredRegion = 'sin1'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const requestedSpaceId = req.nextUrl.searchParams.get('spaceId')
    const payload = await getDashboardPayload(user, requestedSpaceId)

    return NextResponse.json(payload)
  } catch (error) {
    if (error instanceof DashboardDataError) {
      return errorResponse(error.message, error.status, error.code)
    }

    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }

    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
