const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7

export function persistClientSession(token: string) {
  document.cookie = `token=${encodeURIComponent(token)}; path=/; max-age=${SESSION_MAX_AGE_SECONDS}; samesite=lax`
  localStorage.setItem('token', token)
}

export function clearClientSession() {
  document.cookie = 'token=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT; samesite=lax'
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
