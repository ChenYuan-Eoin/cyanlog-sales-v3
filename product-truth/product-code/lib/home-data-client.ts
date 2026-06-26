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

function toCachedProfile(user: LoginProfile) {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone || null,
    display_name: user.displayName || user.email,
    title: null,
    primary_dept_id: '',
    roles: [],
    spaces: [],
  }
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

type HomeInitialLoadOptions = {
  signal?: AbortSignal
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) {
    throw new DOMException('Home initial data load aborted', 'AbortError')
  }
}

export async function loadHomeInitialData(token: string | null | undefined, options: HomeInitialLoadOptions = {}): Promise<HomeInitialData> {
  const signal = options.signal
  throwIfAborted(signal)

  const hasToken = Boolean(token)
  const cacheKey = hasToken ? scopedCacheKey(token, 'home:initial') : null
  const profileCacheKey = hasToken ? scopedCacheKey(token, 'home:profile') : null
  const cached = cacheKey ? readBrowserCache<HomeInitialData>(cacheKey, HOME_INITIAL_CACHE_MS) : null
  if (cached) return cached

  if (!signal && cacheKey) {
    const inflight = homeInitialInflight.get(cacheKey)
    if (inflight) return inflight
  }

  const request = (async () => {
    const requestInit: RequestInit = hasToken
      ? { headers: { Authorization: `Bearer ${token}` }, signal }
      : { signal }
    const cachedProfile = profileCacheKey ? readBrowserCache<unknown>(profileCacheKey, HOME_INITIAL_CACHE_MS) : null
    const profileRequest = fetch('/api/auth/me', requestInit)
      .then(async (profileRes) => {
        if (profileRes.status === 401) throw new HomeInitialAuthError()
        if (!profileRes.ok) throw new HomeInitialLoadError('Profile load failed')

        const profilePayload = await profileRes.json()
        if (!profilePayload.user) throw new HomeInitialLoadError('Profile payload missing user')
        if (profileCacheKey) writeBrowserCache(profileCacheKey, profilePayload.user)
        return profilePayload.user
      })
    const dashboardRes = await fetch('/api/dashboard', requestInit)

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
      if (cacheKey) writeBrowserCache(cacheKey, value)
      return value
    }

    const profile = await profileRequest
    const value = { profile, dashboard }
    if (cacheKey) writeBrowserCache(cacheKey, value)
    return value
  })().finally(() => {
    if (!signal && cacheKey) {
      homeInitialInflight.delete(cacheKey)
    }
  })

  if (!signal && cacheKey) {
    homeInitialInflight.set(cacheKey, request)
  }
  return request
}

export function primeHomeInitialData(token: string | null | undefined) {
  primeHomeAuthContext(token)
  void loadHomeInitialData(token).catch(() => {
    // Login navigation still owns visible error handling if the warm request fails.
  })
}

export function primeHomeAuthContext(token: string | null | undefined) {
  void fetch('/api/auth/context', {
    method: 'POST',
    ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
  }).catch(() => {
    // Middleware falls back to the database-backed auth check if this warmup fails.
  })
}

export function primeHomeProfile(token: string | null | undefined, user: LoginProfile | null | undefined) {
  if (!token || !user?.id) return

  writeBrowserCache(scopedCacheKey(token, 'home:profile'), toCachedProfile(user))
}

export function primeHomeInitialSnapshot(
  token: string | null | undefined,
  user: LoginProfile | null | undefined,
  dashboard: unknown
) {
  if (!token || !user?.id || !dashboard) return

  const profile = toCachedProfile(user)
  writeBrowserCache(scopedCacheKey(token, 'home:profile'), profile)
  writeBrowserCache(scopedCacheKey(token, 'home:initial'), { profile, dashboard })
}
