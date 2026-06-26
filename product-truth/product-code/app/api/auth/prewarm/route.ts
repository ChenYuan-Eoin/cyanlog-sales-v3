import { NextResponse } from 'next/server'

import { warmLoginRuntime } from '@/lib/login-prewarm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'sin1'

export async function POST() {
  try {
    await warmLoginRuntime()
  } catch {
    // This endpoint only warms the route and Supabase client path.
  }

  return NextResponse.json({ ok: true }, {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
