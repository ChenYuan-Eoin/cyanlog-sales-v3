import { NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'sin1'

export async function POST() {
  try {
    const since = new Date(Date.now() - 15 * 60 * 1000).toISOString()
    await Promise.allSettled([
      supabaseAdmin.from('users').select('id').limit(1).maybeSingle(),
      supabaseAdmin.rpc('get_login_candidate_v1', {
        p_email: '__prewarm__@invalid.local',
        p_phone: null,
        p_ip_address: 'prewarm',
        p_since: since,
        p_account_limit: 5,
        p_ip_limit: 15,
      }),
    ])
  } catch {
    // This endpoint only warms the route and Supabase client path.
  }

  return NextResponse.json({ ok: true }, {
    headers: {
      'Cache-Control': 'no-store',
    },
  })
}
