import { CLIENT_AUTH_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from '@/lib/auth-token'

export function persistClientSession(token: string) {
  localStorage.setItem('token', token)
  document.cookie = `${CLIENT_AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; path=/; max-age=${SESSION_MAX_AGE_SECONDS}; samesite=lax`
}

export function clearClientSession() {
  document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT; samesite=lax'
  document.cookie = `${CLIENT_AUTH_COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT; samesite=lax`
  localStorage.removeItem('token')
}

export async function logoutClientSession() {
  const token = localStorage.getItem('token')

  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  } catch {
    // Ignore network failures and still clear the local session.
  } finally {
    clearClientSession()
  }
}
