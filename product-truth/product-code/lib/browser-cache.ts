'use client'

type CacheEnvelope<T> = {
  savedAt: number
  value: T
}

const PREFIX = 'price-v3-cache'

function hashScope(scope: string) {
  let hash = 5381
  for (let index = 0; index < scope.length; index += 1) {
    hash = ((hash << 5) + hash) ^ scope.charCodeAt(index)
  }
  return (hash >>> 0).toString(36)
}

export function scopedCacheKey(scope: string | null | undefined, key: string) {
  return `${PREFIX}:${hashScope(scope || 'anonymous')}:${key}`
}

export function readBrowserCacheEntry<T>(key: string): CacheEnvelope<T> | null {
  if (typeof window === 'undefined') return null

  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null

    const envelope = JSON.parse(raw) as CacheEnvelope<T>
    if (!envelope || typeof envelope.savedAt !== 'number') return null

    return envelope
  } catch {
    return null
  }
}

export function readBrowserCache<T>(key: string, maxAgeMs: number): T | null {
  const envelope = readBrowserCacheEntry<T>(key)
  if (!envelope) return null
  if (Date.now() - envelope.savedAt > maxAgeMs) return null

  return envelope.value
}

export function writeBrowserCache<T>(key: string, value: T) {
  if (typeof window === 'undefined') return

  try {
    const envelope: CacheEnvelope<T> = {
      savedAt: Date.now(),
      value,
    }
    window.localStorage.setItem(key, JSON.stringify(envelope))
  } catch {
    // Cache writes are opportunistic.
  }
}

export function deleteBrowserCache(key: string) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.removeItem(key)
  } catch {
    // Cache deletion is opportunistic.
  }
}
