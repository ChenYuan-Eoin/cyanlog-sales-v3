import { NextRequest, NextResponse } from 'next/server'

import { supabaseAdmin } from '@/lib/supabase'

function getToken(req: NextRequest) {
  return req.headers.get('authorization')?.replace('Bearer ', '') || req.cookies.get('token')?.value || null
}

export async function POST(req: NextRequest) {
  const token = getToken(req)

  if (token) {
    await supabaseAdmin.from('auth_tokens').delete().eq('token', token)
  }

  const response = NextResponse.json({ success: true })
  response.cookies.set('token', '', {
    path: '/',
    expires: new Date(0),
    sameSite: 'lax',
  })

  return response
}
