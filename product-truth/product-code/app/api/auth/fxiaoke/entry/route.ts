import { NextRequest, NextResponse } from 'next/server'
import { getAuthUser } from '@/lib/auth'
import { fxiaokeReturnPath } from '@/lib/fxiaoke/return-path'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const next = fxiaokeReturnPath(request.nextUrl.searchParams.get('next')) || '/'
  let target: URL
  try {
    // The normal destination route still owns authorization.
    target = new URL(await getAuthUser(request) ? next : '/api/auth/fxiaoke/start', request.nextUrl.origin)
  } catch {
    target = new URL('/login', request.nextUrl.origin)
  }
  if (target.pathname === '/api/auth/fxiaoke/start' || target.pathname === '/login') {
    if (next !== '/') target.searchParams.set('next', next)
  }
  const response = NextResponse.redirect(target, 302)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
