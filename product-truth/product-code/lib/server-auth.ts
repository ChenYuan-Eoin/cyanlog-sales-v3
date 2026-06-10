import { cookies } from 'next/headers'

import { getCookieAuthToken } from '@/lib/auth-token'

export function getServerAuthToken() {
  return getCookieAuthToken(cookies()) || undefined
}
