'use client'

import { useEffect } from 'react'
import { clearClientSession } from '@/lib/session-client'

// Only real foreground input renews the session; polling and merely leaving
// a tab open cannot keep a Fxiaoke login alive.
export function SessionActivity() {
  useEffect(() => {
    let stopped = false
    let managed = false
    let timer: ReturnType<typeof setTimeout>
    let lastRenewal = 0
    let renewing = false
    const controller = new AbortController()
    const initialToken = localStorage.getItem('token')
    function accountChanged() {
      if (localStorage.getItem('token') === initialToken) return false
      stopped = true
      controller.abort()
      clearTimeout(timer)
      // Keep the new account's credentials. A full navigation discards the
      // previous account's React state, records and unsent form values.
      window.location.reload()
      return true
    }
    async function check(renew = false) {
      if (renewing || stopped) return
      if (accountChanged()) return
      renewing = true
      try {
        const token = localStorage.getItem('token')
        const response = await fetch('/api/auth/activity', {
          method: renew ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin',
          headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal,
        })
        if (stopped || accountChanged()) return
        if (response.status === 401) {
          clearClientSession()
          window.location.replace('/login?reason=session_expired')
          return
        }
        if (!response.ok) throw new Error('session unavailable')
        const body = await response.json()
        managed = body.managed === true
        clearTimeout(timer)
        if (managed) {
          const remaining = Date.parse(body.expiresAt) - Date.now()
          if (!Number.isFinite(remaining)) throw new Error('invalid session deadline')
          timer = setTimeout(() => { void check() }, Math.max(1000, remaining))
        }
        if (renew) lastRenewal = Date.now()
      } catch {
        if (!stopped) timer = setTimeout(() => { void check() }, 15_000)
      } finally { renewing = false }
    }
    const onActivity = (event: Event) => {
      if (!stopped && accountChanged()) {
        event.stopImmediatePropagation()
        return
      }
      if (managed && event.isTrusted && document.visibilityState === 'visible'
        && Date.now() - lastRenewal >= 60_000) void check(true)
    }
    const onStorage = (event: StorageEvent) => {
      if (!stopped && (event.key === 'token' || event.key === null)) accountChanged()
    }
    const onFocus = () => { if (!stopped) accountChanged() }
    window.addEventListener('storage', onStorage)
    window.addEventListener('focus', onFocus)
    const events = ['pointerdown', 'keydown', 'wheel', 'touchmove'] as const
    for (const name of events) window.addEventListener(name, onActivity, { passive: true, capture: true })
    void check()
    return () => {
      stopped = true
      controller.abort()
      clearTimeout(timer)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('focus', onFocus)
      for (const name of events) window.removeEventListener(name, onActivity, true)
    }
  }, [])
  return null
}
