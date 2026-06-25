// REQ: F005 - ASK 回应 API
// PURPOSE: 提交 ASK 回应（1:1 一次回答）

import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { submitAskResponse } from '@/lib/ask/submit-response'

interface RouteParams {
  params: Promise<{ id: string; askId: string }> | { id: string; askId: string }
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const resolvedParams = await params
    const { id: contractId, askId } = resolvedParams

    const user = await requireAuth(request)
    const body = await request.json().catch(() => ({}))
    return submitAskResponse({ askId, contractId, body, user })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
