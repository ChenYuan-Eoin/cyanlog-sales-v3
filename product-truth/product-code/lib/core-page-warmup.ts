'use client'

import { readBrowserCacheEntry, scopedCacheKey, writeBrowserCache } from '@/lib/browser-cache'

type PrefetchRoute = (href: string) => void

export type ContractsCachePayload = {
  contracts: unknown[]
  drafts: unknown[]
  meta: {
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

const WARMUP_STALE_MS = 60 * 1000
const WARMUP_DELAY_MS = 250
const CONTRACTS_PAGE_SIZE = 20
const warmups = new Map<string, Promise<void>>()
const contractListWarmups = new Map<string, Promise<ContractsCachePayload | null>>()
const configProductsWarmups = new Map<string, Promise<unknown[] | null>>()
let scheduledToken: string | null = null

function scheduleIdle(callback: () => void) {
  const run = () => {
    const idle = window.requestIdleCallback
    if (idle) {
      idle(callback, { timeout: WARMUP_DELAY_MS })
      return
    }
    window.setTimeout(callback, WARMUP_DELAY_MS)
  }

  window.setTimeout(run, WARMUP_DELAY_MS)
}

function readFreshCache<T>(key: string): T | null {
  const entry = readBrowserCacheEntry<T>(key)
  if (!entry || Date.now() - entry.savedAt >= WARMUP_STALE_MS) return null
  return entry.value
}

export async function loadContractsListForCache(token: string, pageNum = 1, pageSize = CONTRACTS_PAGE_SIZE) {
  const cacheKey = scopedCacheKey(token, `contracts:list:${pageNum}:${pageSize}`)
  const cached = readFreshCache<ContractsCachePayload>(cacheKey)
  if (cached) return cached

  const inflight = contractListWarmups.get(cacheKey)
  if (inflight) return inflight

  const headers = { Authorization: `Bearer ${token}` }
  const request = (async () => {
    const [contractsRes, draftsRes] = await Promise.all([
      fetch(`/api/contracts?page=${pageNum}&pageSize=${pageSize}`, { headers }),
      fetch('/api/contracts/drafts', { headers }),
    ])

    if (!contractsRes.ok || !draftsRes.ok) return null

    const [contractsJson, draftsJson] = await Promise.all([
      contractsRes.json(),
      draftsRes.json(),
    ])
    const meta = contractsJson.data?.meta || {}
    const payload: ContractsCachePayload = {
      contracts: contractsJson.data?.data || [],
      drafts: draftsJson.data || [],
      meta: {
        totalPages: meta.totalPages || 1,
        hasNext: Boolean(meta.hasNext),
        hasPrev: Boolean(meta.hasPrev),
      },
    }

    writeBrowserCache(cacheKey, payload)
    return payload
  })().finally(() => {
    contractListWarmups.delete(cacheKey)
  })

  contractListWarmups.set(cacheKey, request)
  return request
}

export async function loadConfigProductsForCache(token: string) {
  const cacheKey = scopedCacheKey(token, 'configs:price-list')
  const cached = readFreshCache<unknown[]>(cacheKey)
  if (cached) return cached

  const inflight = configProductsWarmups.get(cacheKey)
  if (inflight) return inflight

  const request = fetch('/api/products?summary=1', {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(async (productsRes) => {
      if (!productsRes.ok) return null

      const productsJson = await productsRes.json()
      const products = productsJson.data || []
      writeBrowserCache(cacheKey, products)
      return products
    })
    .finally(() => {
      configProductsWarmups.delete(cacheKey)
    })

  configProductsWarmups.set(cacheKey, request)
  return request
}

async function warmCoreData(token: string, prefetchRoute?: PrefetchRoute) {
  prefetchRoute?.('/contracts')
  prefetchRoute?.('/tenders')
  prefetchRoute?.('/configs')

  await Promise.allSettled([
    loadContractsListForCache(token),
    loadConfigProductsForCache(token),
  ])
}

export function scheduleCorePageWarmup(token: string | null | undefined, prefetchRoute?: PrefetchRoute) {
  if (typeof window === 'undefined' || !token || scheduledToken === token) return

  scheduledToken = token
  scheduleIdle(() => {
    if (warmups.has(token)) return
    const warmup = warmCoreData(token, prefetchRoute)
      .catch(() => {
        // Warmup is opportunistic; visible page loads still own error handling.
      })
      .finally(() => {
        warmups.delete(token)
      })
    warmups.set(token, warmup)
  })
}
