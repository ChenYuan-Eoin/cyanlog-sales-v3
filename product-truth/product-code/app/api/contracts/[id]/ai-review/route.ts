// REQ:F005 + AI Streaming with SpaceX-level fault tolerance
// PURPOSE: Stream AI contract review with multi-level failover

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { reviewWithFailover } from '@/lib/ai/failover'
import { getRequestId, logRouteDone, logRouteFailure, logRouteStart } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const startedAt = Date.now()
  const requestId = getRequestId(req)
  const route = '/api/contracts/[id]/ai-review'

  try {
    const user = await requireAuth(req)
    const contractId = params.id
    logRouteStart({
      route,
      requestId,
      userId: user.id,
      details: { contractId },
    })

    // Fetch contract with owner verification
    const { data: contract, error } = await supabaseAdmin
      .from('contracts')
      .select('id, filename, parsed_text, created_by')
      .eq('id', contractId)
      .eq('created_by', user.id)
      .single()

    if (error || !contract) {
      return NextResponse.json(
        { error: 'Contract not found or access denied' },
        { status: 404 }
      )
    }

    const contractText = contract.parsed_text || 'No text available for review'

    // SpaceX级故障转移：本地 → 云端 → 规则引擎 → 人工标记
    const { stream, provider, degraded } = await reviewWithFailover(contractText)

    // 添加响应头标识降级状态
    const headers = new Headers()
    headers.set('X-AI-Provider', provider)
    headers.set('X-AI-Degraded', degraded ? 'true' : 'false')

    logRouteDone(
      {
        route,
        requestId,
        userId: user.id,
        details: { contractId },
      },
      startedAt,
      {
        provider,
        degraded,
      }
    )

    return new NextResponse(stream, {
      headers,
      status: 200,
    })

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
        details: { contractId: params.id },
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
