import { NextRequest, NextResponse } from 'next/server'

import { AUTH_CONTEXT_COOKIE_NAME } from '@/lib/auth-context-cookie'
import { CLIENT_AUTH_COOKIE_NAME, getRequestAuthToken, SERVER_AUTH_COOKIE_NAME } from '@/lib/auth-token'
import { invalidateAuthCache } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

function getToken(req: NextRequest) {
  return getRequestAuthToken(req)
}

export async function POST(req: NextRequest) {
  const token = getToken(req)

  if (token) {
    invalidateAuthCache(token)
    await supabaseAdmin.from('auth_tokens').delete().eq('token', token)
  }

  const response = NextResponse.json({ success: true })
  response.cookies.set(SERVER_AUTH_COOKIE_NAME, '', {
    path: '/',
    expires: new Date(0),
    sameSite: 'lax',
  })
  response.cookies.set(CLIENT_AUTH_COOKIE_NAME, '', {
    path: '/',
    expires: new Date(0),
    sameSite: 'lax',
  })
  response.cookies.set(AUTH_CONTEXT_COOKIE_NAME, '', {
    path: '/',
    expires: new Date(0),
    sameSite: 'lax',
  })

  return response
}
