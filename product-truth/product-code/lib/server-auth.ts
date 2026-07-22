import { cookies } from 'next/headers'

import { getCookieAuthToken } from '@/lib/auth-token'

export async function getServerAuthToken() {
  return getCookieAuthToken(await cookies()) || undefined
}
