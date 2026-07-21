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

export type QuotesCachePayload = {
  quotes: unknown[]
}

export type QuoteDetailCachePayload = unknown

export type TendersCachePayload = {
  tenders: unknown[]
}

export type CorePageCachePayload = {
  contracts?: ContractsCachePayload | null
  configs?: {
    products?: unknown[] | null
  } | null
  quotes?: QuotesCachePayload | null
  tenders?: TendersCachePayload | null
  agenda?: AgendaUpcomingCachePayload | null
}

export const CORE_PAGE_BACKGROUND_REFRESH_MS = 60 * 1000
export const CORE_PAGE_VISIBLE_CACHE_TTL_MS = 5 * 60 * 1000
export const QUOTE_DETAIL_BACKGROUND_REFRESH_MS = CORE_PAGE_BACKGROUND_REFRESH_MS
export const QUOTE_DETAIL_VISIBLE_CACHE_TTL_MS = CORE_PAGE_VISIBLE_CACHE_TTL_MS
const CONTRACTS_WARMUP_DELAY_MS = 150
const WARMUP_DELAY_MS = 250
const CONTRACTS_PAGE_SIZE = 20
export const CONTRACTS_LIST_CACHE_PREFIX = 'contracts:list:v3'
export const AGENDA_UPCOMING_CACHE_KEY = 'agenda:upcoming'
const CORE_ROUTES = ['/contracts', '/quotes', '/tenders', '/configs', '/schedule'] as const
const warmups = new Map<string, Promise<void>>()
const contractListWarmups = new Map<string, Promise<ContractsCachePayload | null>>()
const configProductsWarmups = new Map<string, Promise<unknown[] | null>>()
const configCenterWarmups = new Map<string, Promise<unknown | null>>()
const agendaUpcomingWarmups = new Map<string, Promise<AgendaUpcomingCachePayload | null>>()
const quoteListWarmups = new Map<string, Promise<QuotesCachePayload | null>>()
const quoteDetailWarmups = new Map<string, Promise<QuoteDetailCachePayload | null>>()
const tenderListWarmups = new Map<string, Promise<TendersCachePayload | null>>()
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
  if (!entry || Date.now() - entry.savedAt >= CORE_PAGE_BACKGROUND_REFRESH_MS) return null
  return entry.value
}

function prefetchCoreRoutes(prefetchRoute?: PrefetchRoute) {
  if (!prefetchRoute) return
  for (const href of CORE_ROUTES) {
    prefetchRoute(href)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function hasContractTaskSummaryShape(contract: unknown): boolean {
  if (!isRecord(contract)) return false
  const currentVersionId = contract.current_version_id
  const latestReview = contract.latest_review
  return (
    Array.isArray(contract.contract_versions)
    && Array.isArray(contract.contract_comparisons)
    && (currentVersionId === null || typeof currentVersionId === 'string')
    && (latestReview === null || isRecord(latestReview))
    && isRecord(contract.source_identity)
  )
}

function normalizeContractsCachePayload(value: unknown): ContractsCachePayload | null {
  if (!isRecord(value)) return null

  const meta = isRecord(value.meta) ? value.meta : {}
  return {
    contracts: Array.isArray(value.contracts) ? value.contracts : [],
    drafts: Array.isArray(value.drafts) ? value.drafts : [],
    meta: {
      totalPages: typeof meta.totalPages === 'number' ? meta.totalPages : 1,
      hasNext: Boolean(meta.hasNext),
      hasPrev: Boolean(meta.hasPrev),
    },
  }
}

function normalizeQuotesCachePayload(value: unknown): QuotesCachePayload | null {
  if (!isRecord(value)) return null
  return {
    quotes: Array.isArray(value.quotes) ? value.quotes : [],
  }
}

function normalizeTendersCachePayload(value: unknown): TendersCachePayload | null {
  if (!isRecord(value)) return null
  return {
    tenders: Array.isArray(value.tenders) ? value.tenders : [],
  }
}

function normalizeAgendaUpcomingCachePayload(value: unknown): AgendaUpcomingCachePayload | null {
  if (!isRecord(value)) return null
  return {
    items: Array.isArray(value.items) ? value.items as AgendaItem[] : [],
  }
}

export function primeCorePageCaches(token: string | null | undefined, payload: CorePageCachePayload | null | undefined) {
  if (typeof window === 'undefined' || !token || !isRecord(payload)) return

  const contracts = normalizeContractsCachePayload(payload.contracts)
  const contractsHaveTaskSummaryShape = contracts?.contracts.every(hasContractTaskSummaryShape)
  if (contracts && contractsHaveTaskSummaryShape) {
    writeBrowserCache(scopedCacheKey(token, `${CONTRACTS_LIST_CACHE_PREFIX}:1:${CONTRACTS_PAGE_SIZE}`), contracts)
  }

  const products = isRecord(payload.configs) && Array.isArray(payload.configs.products)
    ? payload.configs.products
    : null
  if (products) {
    writeBrowserCache(scopedCacheKey(token, 'configs:price-list'), products)
  }

  const quotes = normalizeQuotesCachePayload(payload.quotes)
  if (quotes) {
    writeBrowserCache(scopedCacheKey(token, 'quotes:list'), quotes)
  }

  const tenders = normalizeTendersCachePayload(payload.tenders)
  if (tenders) {
    writeBrowserCache(scopedCacheKey(token, 'tenders:list'), tenders)
  }

  const agenda = normalizeAgendaUpcomingCachePayload(payload.agenda)
  if (agenda) {
    writeBrowserCache(scopedCacheKey(token, AGENDA_UPCOMING_CACHE_KEY), agenda)
  }
}

export async function loadContractsListForCache(token: string, pageNum = 1, pageSize = CONTRACTS_PAGE_SIZE) {
  const cacheKey = scopedCacheKey(token, `${CONTRACTS_LIST_CACHE_PREFIX}:${pageNum}:${pageSize}`)
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

export async function loadConfigCenterForCache(token: string) {
  const cacheKey = scopedCacheKey(token, 'configs:center')
  const cached = readFreshCache(cacheKey)
  if (cached) return cached

  const inflight = configCenterWarmups.get(cacheKey)
  if (inflight) return inflight

  const headers = { Authorization: `Bearer ${token}` }
  const request = Promise.allSettled([
    fetch('/api/configs', { headers }),
    fetch('/api/configs/ai-runtime', { headers, cache: 'no-store' }),
  ])
    .then(async ([configsResult, runtimeResult]) => {
      const payload: {
        configs?: unknown[]
        aiRuntimePolicy?: unknown
      } = {}

      if (configsResult.status === 'fulfilled' && configsResult.value.ok) {
        const configsJson = await configsResult.value.json().catch(() => null)
        const configs = Array.isArray(configsJson?.data) ? configsJson.data : []
        payload.configs = configs
        for (const tab of ['tax', 'approval', 'ai', 'theme']) {
          writeBrowserCache(scopedCacheKey(token, `configs:${tab}`), configs)
        }
      }

      if (runtimeResult.status === 'fulfilled' && runtimeResult.value.ok) {
        const runtimeJson = await runtimeResult.value.json().catch(() => null)
        if (runtimeJson?.data) {
          payload.aiRuntimePolicy = runtimeJson.data
          writeBrowserCache(scopedCacheKey(token, 'configs:ai-runtime'), runtimeJson.data)
        }
      }

      if (!payload.configs && !payload.aiRuntimePolicy) {
        return null
      }

      writeBrowserCache(cacheKey, payload)
      return payload
    })
    .finally(() => {
      configCenterWarmups.delete(cacheKey)
    })

  configCenterWarmups.set(cacheKey, request)
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

export async function loadQuotesListForCache(token: string) {
  const cacheKey = scopedCacheKey(token, 'quotes:list')
  const cached = readFreshCache<QuotesCachePayload>(cacheKey)
  if (cached) return cached

  const inflight = quoteListWarmups.get(cacheKey)
  if (inflight) return inflight

  const request = fetch('/api/quotes', {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(async (quotesRes) => {
      if (!quotesRes.ok) return null

      const quotesJson = await quotesRes.json()
      const payload: QuotesCachePayload = {
        quotes: quotesJson.data || [],
      }
      writeBrowserCache(cacheKey, payload)
      return payload
    })
    .finally(() => {
      quoteListWarmups.delete(cacheKey)
    })

  quoteListWarmups.set(cacheKey, request)
  return request
}

export function quoteDetailCacheKey(token: string | null | undefined, quoteId: string) {
  return scopedCacheKey(token, `quotes:detail:${quoteId}`)
}

export async function loadQuoteDetailForCache(
  token: string,
  quoteId: string,
  { force = false }: { force?: boolean } = {}
) {
  const cacheKey = quoteDetailCacheKey(token, quoteId)
  if (!force) {
    const cached = readFreshCache<QuoteDetailCachePayload>(cacheKey)
    if (cached) return cached
  }

  const inflight = quoteDetailWarmups.get(cacheKey)
  if (inflight) return inflight

  const request = fetch(`/api/quotes/${quoteId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(async (quoteRes) => {
      if (!quoteRes.ok) return null

      const payload = await quoteRes.json()
      writeBrowserCache(cacheKey, payload)
      return payload
    })
    .finally(() => {
      quoteDetailWarmups.delete(cacheKey)
    })

  quoteDetailWarmups.set(cacheKey, request)
  return request
}

export function scheduleQuoteDetailWarmup(
  token: string | null | undefined,
  quotes: Array<{ id?: unknown }>,
  limit = 2
) {
  if (typeof window === 'undefined' || !token || quotes.length === 0) return

  const quoteIds = quotes
    .map((quote) => quote.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .slice(0, limit)

  if (quoteIds.length === 0) return

  scheduleIdle(() => {
    void Promise.allSettled(
      quoteIds.map((quoteId) => loadQuoteDetailForCache(token, quoteId))
    )
  })
}

export async function loadTendersListForCache(token: string) {
  const cacheKey = scopedCacheKey(token, 'tenders:list')
  const cached = readFreshCache<TendersCachePayload>(cacheKey)
  if (cached) return cached

  const inflight = tenderListWarmups.get(cacheKey)
  if (inflight) return inflight

  const request = fetch('/api/tenders', {
    headers: { Authorization: `Bearer ${token}` },
  })
    .then(async (tendersRes) => {
      if (!tendersRes.ok) return null

      const tendersJson = await tendersRes.json()
      const payload: TendersCachePayload = {
        tenders: tendersJson.data || [],
      }
      writeBrowserCache(cacheKey, payload)
      return payload
    })
    .finally(() => {
      tenderListWarmups.delete(cacheKey)
    })

  tenderListWarmups.set(cacheKey, request)
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
    loadQuotesListForCache(token),
    loadTendersListForCache(token),
    loadConfigProductsForCache(token),
    loadConfigCenterForCache(token),
    loadAgendaUpcomingForCache(token),
  ])
}

export function scheduleCorePageWarmup(token: string | null | undefined, prefetchRoute?: PrefetchRoute) {
  if (typeof window === 'undefined' || !token || scheduledToken === token) return

  scheduledToken = token
  prefetchCoreRoutes(prefetchRoute)
  window.setTimeout(() => {
    const pathname = window.location.pathname
    if (pathname !== '/' && pathname !== '/contracts') return
    void loadContractsListForCache(token).catch(() => {
      // Visible contract page loads still own error handling.
    })
  }, CONTRACTS_WARMUP_DELAY_MS)
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
