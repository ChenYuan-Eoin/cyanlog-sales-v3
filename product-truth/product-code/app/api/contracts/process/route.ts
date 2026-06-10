import { NextRequest, NextResponse } from 'next/server'

import { processQueuedContractAnalysisJobs } from '@/lib/contract-analysis'
import { getRequestId, logRouteDone, logRouteFailure, logRouteStart } from '@/lib/observability'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return true
  }

  const header = req.headers.get('authorization')
  const token = header?.startsWith('Bearer ') ? header.slice(7) : header

  return token === secret
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now()
  const requestId = getRequestId(req)
  const route = '/api/contracts/process'

  logRouteStart({
    route,
    requestId,
  })

  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const processed = await processQueuedContractAnalysisJobs('contracts-worker', 3)

    logRouteDone(
      { route, requestId },
      startedAt,
      {
        processed: processed.length,
      }
    )

    return NextResponse.json({
      success: true,
      processed,
      count: processed.length,
    })
  } catch (error) {
    await logRouteFailure(
      req,
      { route, requestId },
      startedAt,
      error
    )

    return NextResponse.json(
      { error: 'Failed to process contract analysis jobs' },
      { status: 500 }
    )
  }
}
