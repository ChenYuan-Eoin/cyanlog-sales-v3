import { NextResponse } from 'next/server'

import { formatLoginPrewarmTiming, warmLoginRuntime } from '@/lib/login-prewarm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'sin1'

export async function POST() {
  let prewarmTiming = ''
  try {
    prewarmTiming = formatLoginPrewarmTiming(await warmLoginRuntime())
  } catch {
    // This endpoint only warms the route and Supabase client path.
  }

  const response = NextResponse.json({ ok: true }, {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
  if (prewarmTiming) {
    response.headers.set('X-Login-Prewarm-Timing', prewarmTiming)
  }
  return response
}
