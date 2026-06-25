// REQ:F005
// PURPOSE: 提交 ASK 回应

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { submitAskResponse } from '@/lib/ask/submit-response'

interface RouteParams {
  params: Promise<{ askId: string }> | { askId: string }
}

export async function POST(
  req: NextRequest,
  { params }: RouteParams
) {
  try {
    const { askId } = await params
    const user = await requireAuth(req)
    const body = await req.json().catch(() => ({}))
    return submitAskResponse({ askId, body, user })
  } catch (err: unknown) {
    const authError = err instanceof Error && err.name === 'AuthError'
    if (authError) {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    return NextResponse.json({ error: '提交回应失败' }, { status: 500 })
  }
}
