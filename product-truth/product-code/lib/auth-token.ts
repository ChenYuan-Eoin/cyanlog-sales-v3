import type { NextRequest } from 'next/server'

export const SERVER_AUTH_COOKIE_NAME = 'token'
export const CLIENT_AUTH_COOKIE_NAME = 'client_token'
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

type CookieValue = { value: string } | undefined
type CookieReader = {
  get(name: string): CookieValue
}

export function getCookieAuthToken(cookies: CookieReader): string | null {
  return cookies.get(SERVER_AUTH_COOKIE_NAME)?.value
    || cookies.get(CLIENT_AUTH_COOKIE_NAME)?.value
    || null
}

export function getRequestAuthToken(req: NextRequest): string | null {
  return req.headers.get('authorization')?.replace('Bearer ', '')
    || getCookieAuthToken(req.cookies)
}
