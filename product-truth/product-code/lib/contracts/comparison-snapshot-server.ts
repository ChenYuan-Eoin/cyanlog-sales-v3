import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'

export type ComparisonSourceRole = 'old' | 'new'

export interface FrozenComparisonPageRange {
  page: number
  start: number
  end: number
  locator: 'rendered' | 'provisional'
  line_boxes?: Array<{
    start: number
    end: number
    text: string
    left: number
    top: number
    width: number
    height: number
  }>
}

export interface FrozenComparisonPageMap {
  page_count: number
  locator: 'rendered' | 'provisional'
  pages: FrozenComparisonPageRange[]
}

export interface FrozenComparisonSource {
  id: string
  comparison_id: string
  org_id: string
  role: ComparisonSourceRole
  contract_id: string
  origin_storage_path: string
  storage_path: string
  file_name: string
  file_size: number
  mime_type: string
  file_sha256: string
  text_sha256: string
  parsed_text: string
  text_reliability: 'verified' | 'unavailable'
  render_mode: 'native-pdf' | 'browser-ooxml'
  page_map: FrozenComparisonPageMap
  captured_at: string
}

export interface FrozenComparisonDownloadOptions {
  /** Skip the process-local five minute byte cache. */
  bypassCache?: boolean
  /**
   * Re-read the Storage object with a unique cache nonce and `cache: no-store`.
   * This is used by release evidence such as the downloadable comparison report,
   * where a recently cached byte array must not conceal a deleted Storage object.
   */
  forceStorageVerification?: boolean
}

export interface FrozenSourceCleanupResult {
  status: 'not_needed' | 'complete' | 'verification_failed' | 'removal_failed'
  requested_count: number
  referenced_count: number
  removed_count: number
  retained_count: number
  comparison_ids: string[]
  error?: string
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/
const frozenByteCache = new Map<string, { bytes: Buffer; createdAt: number }>()
const FROZEN_BYTE_CACHE_TTL_MS = 5 * 60 * 1000
const FROZEN_BYTE_CACHE_MAX_ENTRIES = 4

function pruneFrozenByteCache(now = Date.now()) {
  for (const [key, cached] of frozenByteCache.entries()) {
    if (now - cached.createdAt >= FROZEN_BYTE_CACHE_TTL_MS) frozenByteCache.delete(key)
  }
  while (frozenByteCache.size > FROZEN_BYTE_CACHE_MAX_ENTRIES) {
    const oldest = frozenByteCache.keys().next().value as string | undefined
    if (!oldest) break
    frozenByteCache.delete(oldest)
  }
}

function isPageMap(value: unknown): value is FrozenComparisonPageMap {
  if (!value || typeof value !== 'object') return false
  const pageMap = value as Partial<FrozenComparisonPageMap>
  return Number.isInteger(pageMap.page_count)
    && Number(pageMap.page_count) > 0
    && (pageMap.locator === 'rendered' || pageMap.locator === 'provisional')
    && Array.isArray(pageMap.pages)
    && pageMap.pages.length === pageMap.page_count
}

export function assertFrozenComparisonSource(value: unknown): asserts value is FrozenComparisonSource {
  if (!value || typeof value !== 'object') throw new Error('比对源快照不存在')
  const source = value as Partial<FrozenComparisonSource>
  if (source.role !== 'old' && source.role !== 'new') throw new Error('比对源文件角色无效')
  if (!source.id || !source.comparison_id || !source.org_id || !source.contract_id) {
    throw new Error('比对源快照缺少身份字段')
  }
  if (!source.origin_storage_path || !source.storage_path || !source.file_name || !source.mime_type) {
    throw new Error('比对源快照缺少文件身份')
  }
  if (
    source.storage_path === source.origin_storage_path
    || !source.storage_path.startsWith(`g6-frozen/${source.org_id}/`)
  ) throw new Error('比对源快照没有绑定独立冻结副本')
  if (!Number.isSafeInteger(source.file_size) || Number(source.file_size) < 1) {
    throw new Error('比对源快照文件大小无效')
  }
  if (!source.file_sha256 || !SHA256_PATTERN.test(source.file_sha256)) {
    throw new Error('比对源快照文件摘要无效')
  }
  if (!source.text_sha256 || !SHA256_PATTERN.test(source.text_sha256)) {
    throw new Error('比对源快照文本摘要无效')
  }
  if (typeof source.parsed_text !== 'string') throw new Error('比对源快照缺少冻结原文')
  if (createHash('sha256').update(source.parsed_text).digest('hex') !== source.text_sha256) {
    throw new Error('比对源快照冻结原文与摘要不一致')
  }
  if (source.render_mode !== 'native-pdf' && source.render_mode !== 'browser-ooxml') {
    throw new Error('比对源快照渲染模式无效')
  }
  if (
    (source.text_reliability === 'verified' && !source.parsed_text.trim())
    || (source.text_reliability === 'unavailable' && source.parsed_text !== '')
    || (source.text_reliability !== 'verified' && source.text_reliability !== 'unavailable')
  ) throw new Error('比对源快照文本可靠性无效')
  if (!isPageMap(source.page_map)) throw new Error('比对源快照页级映射不完整')
}

export async function loadFrozenComparisonSource(
  comparisonId: string,
  role: ComparisonSourceRole,
  orgId: string,
) {
  const { data, error } = await supabaseAdmin
    .from('contract_comparison_sources')
    .select('id,comparison_id,org_id,role,contract_id,origin_storage_path,storage_path,file_name,file_size,mime_type,file_sha256,text_sha256,parsed_text,text_reliability,render_mode,page_map,captured_at')
    .eq('comparison_id', comparisonId)
    .eq('role', role)
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throw new Error('比对源快照查询失败')
  if (!data) return null
  const rawPages = Array.isArray(data.page_map) ? data.page_map : null
  if (!rawPages || rawPages.length < 1) throw new Error('比对源快照页级映射不完整')
  const normalized = {
    ...data,
    file_size: Number(data.file_size),
    page_map: {
      page_count: rawPages.length,
      locator: rawPages.every((page) => (
        page && typeof page === 'object' && (page as { locator?: unknown }).locator === 'rendered'
      )) ? 'rendered' as const : 'provisional' as const,
      pages: rawPages,
    },
  }
  assertFrozenComparisonSource(normalized)
  return normalized
}

export async function cleanupUnreferencedFrozenSources(
  candidatePaths: string[],
): Promise<FrozenSourceCleanupResult> {
  const paths = [...new Set(candidatePaths.filter(Boolean))]
  const base = {
    requested_count: paths.length,
    referenced_count: 0,
    removed_count: 0,
    retained_count: paths.length,
    comparison_ids: [] as string[],
  }
  if (paths.length === 0) return { status: 'not_needed', ...base }

  // This cleanup primitive is deliberately incapable of deleting ordinary
  // contract uploads. It only accepts paths created by G6 materialization.
  if (paths.some((path) => !path.startsWith('g6-frozen/'))) {
    return {
      status: 'verification_failed',
      ...base,
      error: '冻结对象候选路径无效',
    }
  }

  let references: Array<{ storage_path: string; comparison_id: string }>
  try {
    const { data, error } = await supabaseAdmin
      .from('contract_comparison_sources')
      .select('storage_path,comparison_id')
      .in('storage_path', paths)
    if (error) {
      return {
        status: 'verification_failed',
        ...base,
        error: error.message || '冻结对象引用查询失败',
      }
    }
    references = (data || []) as Array<{ storage_path: string; comparison_id: string }>
  } catch (error) {
    return {
      status: 'verification_failed',
      ...base,
      error: error instanceof Error ? error.message : '冻结对象引用查询失败',
    }
  }

  const referencedPaths = new Set(references.map((row) => row.storage_path))
  const removable = paths.filter((path) => !referencedPaths.has(path))
  const comparisonIds = [...new Set(references.map((row) => row.comparison_id).filter(Boolean))]
  const verifiedBase = {
    requested_count: paths.length,
    referenced_count: referencedPaths.size,
    removed_count: 0,
    retained_count: paths.length,
    comparison_ids: comparisonIds,
  }
  if (removable.length === 0) return { status: 'complete', ...verifiedBase }

  try {
    const { error } = await supabaseAdmin.storage.from('contracts').remove(removable)
    if (error) {
      return {
        status: 'removal_failed',
        ...verifiedBase,
        error: error.message || '冻结对象删除失败',
      }
    }
  } catch (error) {
    return {
      status: 'removal_failed',
      ...verifiedBase,
      error: error instanceof Error ? error.message : '冻结对象删除失败',
    }
  }

  return {
    status: 'complete',
    ...verifiedBase,
    removed_count: removable.length,
    retained_count: referencedPaths.size,
  }
}

export async function downloadFrozenComparisonSource(
  source: FrozenComparisonSource,
  options: FrozenComparisonDownloadOptions = {},
) {
  assertFrozenComparisonSource(source)
  const cacheKey = `${source.storage_path}:${source.file_sha256}:${source.file_size}`
  pruneFrozenByteCache()
  const cached = frozenByteCache.get(cacheKey)
  const bypassMemoryCache = options.bypassCache || options.forceStorageVerification
  if (
    !bypassMemoryCache
    && cached
    && Date.now() - cached.createdAt < FROZEN_BYTE_CACHE_TTL_MS
  ) return cached.bytes

  const bucket = supabaseAdmin.storage.from('contracts')
  const download = options.forceStorageVerification
    ? bucket.download(
        source.storage_path,
        { cacheNonce: randomUUID() },
        { cache: 'no-store' },
      )
    : bucket.download(source.storage_path)
  const { data, error } = await download
  if (error || !data) throw new Error('冻结原文件下载失败')
  const bytes = Buffer.from(await data.arrayBuffer())
  if (bytes.byteLength !== source.file_size) throw new Error('冻结原文件大小与快照不一致')
  if (createHash('sha256').update(bytes).digest('hex') !== source.file_sha256) {
    throw new Error('冻结原文件字节与快照摘要不一致')
  }
  frozenByteCache.set(cacheKey, { bytes, createdAt: Date.now() })
  pruneFrozenByteCache()
  return bytes
}

export async function createFrozenComparisonSourceTicket(source: FrozenComparisonSource) {
  assertFrozenComparisonSource(source)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleKey) throw new Error('合同源文件服务未配置')

  const encodedPath = source.storage_path
    .replace(/^\/+/, '')
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
  const response = await fetch(`${supabaseUrl}/storage/v1/object/sign/contracts/${encodedPath}`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ expiresIn: 60 }),
    cache: 'no-store',
  })
  const payload = await response.json().catch(() => null) as { signedURL?: string } | null
  if (!response.ok || !payload?.signedURL) throw new Error('冻结原文件短期读取地址生成失败')
  return new URL(`/storage/v1${payload.signedURL}`, supabaseUrl).toString()
}
