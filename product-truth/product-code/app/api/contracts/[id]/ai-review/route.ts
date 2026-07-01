// REQ:F005 + F006
// PURPOSE: Legacy AI review endpoint guard. Formal review must go through ReviewRun.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getRequestId, logRouteDone, logRouteFailure, logRouteStart } from '@/lib/observability'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  const startedAt = Date.now()
  const requestId = getRequestId(req)
  const route = '/api/contracts/[id]/ai-review'
  let contractId = ''

  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { userIds: accessibleUserIds } = await listAccessibleUserIds(user.id, orgId)
    contractId = await resolveIdParam(params)
    logRouteStart({
      route,
      requestId,
      userId: user.id,
      details: { contractId },
    })

    // Fetch contract with owner verification
    const { data: contract, error } = await supabaseAdmin
      .from('contracts')
      .select('id, filename, created_by')
      .eq('id', contractId)
      .eq('org_id', orgId)
      .in('created_by', accessibleUserIds)
      .maybeSingle()

    if (error || !contract) {
      return NextResponse.json(
        { error: 'Contract not found or access denied' },
        { status: 404 }
      )
    }

    logRouteDone(
      {
        route,
        requestId,
        userId: user.id,
        details: { contractId, legacyEndpoint: true },
      },
      startedAt,
      { legacyEndpoint: true }
    )

    return NextResponse.json(
      {
        code: 'LEGACY_AI_REVIEW_DISABLED',
        error: '旧流式 AI 审核入口已停用，请使用 ReviewRun 审核链路。',
        replacement: `/api/contracts/${contractId}/review-runs`,
      },
      { status: 410 }
    )

  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    await logRouteFailure(
      req,
      {
        route,
        requestId,
        details: { contractId },
      },
      startedAt,
      error
    )

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'AI review failed' },
      { status: 500 }
    )
  }
}
