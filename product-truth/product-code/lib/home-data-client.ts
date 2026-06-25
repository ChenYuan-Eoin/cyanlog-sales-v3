'use client'

import { readBrowserCache, scopedCacheKey, writeBrowserCache } from '@/lib/browser-cache'

type HomeInitialData = {
  profile: unknown
  dashboard: unknown
}

type LoginProfile = {
  id: string
  email: string
  phone?: string | null
  displayName?: string | null
}

const HOME_INITIAL_CACHE_MS = 15_000
const homeInitialInflight = new Map<string, Promise<HomeInitialData>>()

export class HomeInitialAuthError extends Error {
  constructor() {
    super('Home initial data auth failed')
    this.name = 'HomeInitialAuthError'
  }
}

export class HomeInitialLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HomeInitialLoadError'
  }
}

export async function loadHomeInitialData(token: string): Promise<HomeInitialData> {
  const cacheKey = scopedCacheKey(token, 'home:initial')
  const profileCacheKey = scopedCacheKey(token, 'home:profile')
  const cached = readBrowserCache<HomeInitialData>(cacheKey, HOME_INITIAL_CACHE_MS)
  if (cached) return cached

  const inflight = homeInitialInflight.get(cacheKey)
  if (inflight) return inflight

  const request = (async () => {
    const authHeaders = { Authorization: `Bearer ${token}` }
    const cachedProfile = readBrowserCache<unknown>(profileCacheKey, HOME_INITIAL_CACHE_MS)
    const profileRequest = fetch('/api/auth/me', { headers: authHeaders })
      .then(async (profileRes) => {
        if (profileRes.status === 401) throw new HomeInitialAuthError()
        if (!profileRes.ok) throw new HomeInitialLoadError('Profile load failed')

        const profilePayload = await profileRes.json()
        if (!profilePayload.user) throw new HomeInitialLoadError('Profile payload missing user')
        writeBrowserCache(profileCacheKey, profilePayload.user)
        return profilePayload.user
      })
    const dashboardRes = await fetch('/api/dashboard', { headers: authHeaders })

    if (dashboardRes.status === 401) {
      throw new HomeInitialAuthError()
    }
    if (!dashboardRes.ok) {
      throw new HomeInitialLoadError('Dashboard load failed')
    }

    const dashboard = await dashboardRes.json()
    if (cachedProfile) {
      void profileRequest.catch(() => undefined)
      const value = { profile: cachedProfile, dashboard }
      writeBrowserCache(cacheKey, value)
      return value
    }

    const profile = await profileRequest
    const value = { profile, dashboard }
    writeBrowserCache(cacheKey, value)
    return value
  })().finally(() => {
    homeInitialInflight.delete(cacheKey)
  })

  homeInitialInflight.set(cacheKey, request)
  return request
}

export function primeHomeInitialData(token: string | null | undefined) {
  if (!token) return
  primeHomeAuthContext(token)
  void loadHomeInitialData(token).catch(() => {
    // Login navigation still owns visible error handling if the warm request fails.
  })
}

export function primeHomeAuthContext(token: string | null | undefined) {
  if (!token) return

  void fetch('/api/auth/context', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {
    // Middleware falls back to the database-backed auth check if this warmup fails.
  })
}

export function primeHomeProfile(token: string | null | undefined, user: LoginProfile | null | undefined) {
  if (!token || !user?.id) return

  writeBrowserCache(scopedCacheKey(token, 'home:profile'), {
    id: user.id,
    email: user.email,
    phone: user.phone || null,
    display_name: user.displayName || user.email,
    title: null,
    primary_dept_id: '',
    roles: [],
    spaces: [],
  })
}
