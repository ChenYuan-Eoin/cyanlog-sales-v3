'use client'

import { deleteBrowserCache, readBrowserCacheEntry, scopedCacheKey, writeBrowserCache } from '@/lib/browser-cache'
import type { AgendaItem } from '@/lib/agenda/types'

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

export type AgendaUpcomingCachePayload = {
  items: AgendaItem[]
}

const WARMUP_STALE_MS = 60 * 1000
const WARMUP_DELAY_MS = 1000
const CONTRACTS_PAGE_SIZE = 20
export const AGENDA_UPCOMING_CACHE_KEY = 'agenda:upcoming'
const CORE_ROUTES = ['/contracts', '/tenders', '/configs', '/schedule'] as const
const warmups = new Map<string, Promise<void>>()
const contractListWarmups = new Map<string, Promise<ContractsCachePayload | null>>()
const configProductsWarmups = new Map<string, Promise<unknown[] | null>>()
const agendaUpcomingWarmups = new Map<string, Promise<AgendaUpcomingCachePayload | null>>()
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

function prefetchCoreRoutes(prefetchRoute?: PrefetchRoute) {
  if (!prefetchRoute) return
  for (const href of CORE_ROUTES) {
    prefetchRoute(href)
  }
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

export async function loadAgendaUpcomingForCache(token: string, limit = 50) {
  const cacheKey = scopedCacheKey(token, AGENDA_UPCOMING_CACHE_KEY)
  const cached = readFreshCache<AgendaUpcomingCachePayload>(cacheKey)
  if (cached) return cached

  const inflight = agendaUpcomingWarmups.get(cacheKey)
  if (inflight) return inflight

  const request = fetch(`/api/agenda/upcoming?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(async (agendaRes) => {
      if (!agendaRes.ok) return null

      const agendaJson = await agendaRes.json()
      const payload: AgendaUpcomingCachePayload = {
        items: agendaJson.data || [],
      }
      writeBrowserCache(cacheKey, payload)
      return payload
    })
    .finally(() => {
      agendaUpcomingWarmups.delete(cacheKey)
    })

  agendaUpcomingWarmups.set(cacheKey, request)
  return request
}

export function invalidateAgendaUpcomingCache(token: string | null | undefined) {
  if (!token) return
  const cacheKey = scopedCacheKey(token, AGENDA_UPCOMING_CACHE_KEY)
  agendaUpcomingWarmups.delete(cacheKey)
  deleteBrowserCache(cacheKey)
}

async function warmCoreData(token: string) {
  await Promise.allSettled([
    loadContractsListForCache(token),
    loadConfigProductsForCache(token),
    loadAgendaUpcomingForCache(token),
  ])
}

export function scheduleCorePageWarmup(token: string | null | undefined, prefetchRoute?: PrefetchRoute) {
  if (typeof window === 'undefined' || !token || scheduledToken === token) return

  scheduledToken = token
  prefetchCoreRoutes(prefetchRoute)
  void loadAgendaUpcomingForCache(token).catch(() => {
    // Visible schedule page loads still own error handling.
  })
  scheduleIdle(() => {
    if (warmups.has(token)) return
    const warmup = warmCoreData(token)
      .catch(() => {
        // Warmup is opportunistic; visible page loads still own error handling.
      })
      .finally(() => {
        warmups.delete(token)
      })
    warmups.set(token, warmup)
  })
}
