import 'server-only'

import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import {
  extractPdfText,
  extractRenderedPageMap,
  sourceRenderMode,
  type RenderedPageMap,
} from './source-render'
import { contractSourceFormatFromFilename } from './source-format'
import { extractCurrentWordText } from './source-text'

export interface SourceContractRecord {
  id: string
  filename: string
  mime_type?: string | null
  storage_path: string
  parsed_text?: string | null
}

interface StoredPageMapRow {
  storage_path: string
  source_hash: string
  source_text_hash: string | null
  render_mode: 'native-pdf' | 'docx-to-pdf' | 'word-to-pdf' | 'browser-ooxml' | 'identity-only'
  page_count: number
  locator: 'rendered' | 'provisional'
  page_map: RenderedPageMap['pages']
}

type HashedRenderedPageMap = RenderedPageMap & {
  source_hash: string
  source_text_hash: string
}

interface RenderContractSourceOptions {
  forceSourceVerification?: boolean
}

const renderCache = new Map<string, {
  createdAt: number
  value: { pdf: Buffer; pageMap: HashedRenderedPageMap; mode: 'pdf' | 'word' }
}>()
const RENDER_CACHE_TTL_MS = 5 * 60 * 1000
const RENDER_CACHE_MAX_ENTRIES = 4

function pruneRenderCache(now = Date.now()) {
  for (const [key, cached] of renderCache.entries()) {
    if (now - cached.createdAt >= RENDER_CACHE_TTL_MS) renderCache.delete(key)
  }
  while (renderCache.size > RENDER_CACHE_MAX_ENTRIES) {
    const oldestKey = renderCache.keys().next().value as string | undefined
    if (!oldestKey) break
    renderCache.delete(oldestKey)
  }
}

function mapFromRow(row: StoredPageMapRow): RenderedPageMap & {
  source_hash: string
  source_text_hash: string | null
  render_mode: StoredPageMapRow['render_mode']
} {
  return {
    source_hash: row.source_hash,
    source_text_hash: row.source_text_hash,
    render_mode: row.render_mode,
    page_count: row.page_count,
    locator: row.locator,
    pages: Array.isArray(row.page_map) ? row.page_map : [],
  }
}

export async function loadStoredContractPageMap(contract: SourceContractRecord) {
  const { data } = await supabaseAdmin
    .from('contract_source_page_maps')
    .select('storage_path,source_hash,source_text_hash,render_mode,page_count,locator,page_map')
    .eq('contract_id', contract.id)
    .eq('storage_path', contract.storage_path)
    .maybeSingle()
  return data ? mapFromRow(data as StoredPageMapRow) : null
}

async function downloadSource(contract: SourceContractRecord) {
  const { data, error } = await supabaseAdmin.storage.from('contracts').download(contract.storage_path)
  if (error || !data) throw new Error('源文件下载失败')
  return Buffer.from(await data.arrayBuffer())
}

async function persistPageMap(
  contract: SourceContractRecord,
  source: Buffer,
  sourceTextHash: string,
  pageMap: RenderedPageMap,
  renderMode: StoredPageMapRow['render_mode']
) {
  const { error } = await supabaseAdmin.from('contract_source_page_maps').upsert({
    contract_id: contract.id,
    storage_path: contract.storage_path,
    source_hash: createHash('sha256').update(source).digest('hex'),
    source_text_hash: sourceTextHash,
    render_mode: renderMode,
    page_count: pageMap.page_count,
    locator: pageMap.locator,
    page_map: pageMap.pages,
    generated_at: new Date().toISOString(),
  }, { onConflict: 'contract_id' })
  if (error) throw error
}

export async function renderContractSource(
  contract: SourceContractRecord,
  options: RenderContractSourceOptions = {}
) {
  const mode = sourceRenderMode(contract.filename, contract.mime_type)
  if (mode === 'unsupported') throw new Error('当前仅支持真实 PDF、DOC、DOCX、DOCM 原文预览')
  if (mode === 'word') throw new Error('Word 原文预览必须使用浏览器安全渲染链，不再调用服务器 Office 转换器')
  const sourceTextHash = createHash('sha256').update(contract.parsed_text || '').digest('hex')
  const cacheKey = `${contract.id}:${contract.storage_path}:${sourceTextHash}`
  pruneRenderCache()
  const cached = renderCache.get(cacheKey)
  if (
    !options.forceSourceVerification
    && cached
    && Date.now() - cached.createdAt < RENDER_CACHE_TTL_MS
  ) return cached.value
  const source = await downloadSource(contract)
  const sourceHash = createHash('sha256').update(source).digest('hex')
  const format = contractSourceFormatFromFilename(contract.filename)
  if (!format) throw new Error('无法识别源文件格式')
  const pdf = source
  const stored = await loadStoredContractPageMap(contract)
  const storedMatchesSource = Boolean(
    stored?.source_hash === sourceHash
    && stored.source_text_hash === sourceTextHash
    && stored.page_count > 0
    && stored.pages.length === stored.page_count
  )
  const pageMap = storedMatchesSource
    ? stored as HashedRenderedPageMap
    : await extractRenderedPageMap(pdf, contract.parsed_text || '')
  if (!storedMatchesSource) await persistPageMap(contract, source, sourceTextHash, pageMap, 'native-pdf')
  const value = { pdf, pageMap: { ...pageMap, source_hash: sourceHash, source_text_hash: sourceTextHash }, mode }
  renderCache.set(cacheKey, { createdAt: Date.now(), value })
  pruneRenderCache()
  return value
}

export async function ensureContractPageMap(
  contract: SourceContractRecord,
  options: RenderContractSourceOptions = {}
) {
  const mode = sourceRenderMode(contract.filename, contract.mime_type)
  if (mode === 'word') {
    const parsedText = contract.parsed_text || ''
    let sourceTextHash = createHash('sha256').update(parsedText).digest('hex')
    const format = contractSourceFormatFromFilename(contract.filename)
    if (!format) throw new Error('无法识别源文件格式')
    const renderMode: StoredPageMapRow['render_mode'] = format === 'doc' ? 'identity-only' : 'browser-ooxml'
    const stored = await loadStoredContractPageMap(contract)
    let storedShapeMatches = Boolean(
      stored?.source_text_hash === sourceTextHash
      && stored.render_mode === renderMode
      && stored.page_count > 0
      && stored.pages.length === stored.page_count
    )
    // Binary DOC has no deterministic server-side text projection. It remains
    // preview-only and cannot enter AI review. DOCX/DOCM must never trust a
    // legacy DB/page-map pair merely because those two stale values agree.
    if (format === 'doc' && !options.forceSourceVerification && storedShapeMatches && stored) {
      return {
        ...stored,
        source_hash: stored.source_hash,
        source_text_hash: sourceTextHash,
      } as HashedRenderedPageMap
    }

    const source = await downloadSource(contract)
    const sourceHash = createHash('sha256').update(source).digest('hex')
    if (format === 'docx' || format === 'docm') {
      const extractedText = await extractCurrentWordText(source, format)
      if (extractedText !== parsedText) {
        throw new Error('当前源文件正文与数据库解析文本不一致')
      }
      sourceTextHash = createHash('sha256').update(extractedText).digest('hex')
      storedShapeMatches = Boolean(
        stored?.source_text_hash === sourceTextHash
        && stored.render_mode === renderMode
        && stored.page_count > 0
        && stored.pages.length === stored.page_count
      )
    }
    const storedMatchesSource = Boolean(
      stored?.source_hash === sourceHash
      && storedShapeMatches
    )
    if (storedMatchesSource) {
      return {
        ...stored,
        source_hash: sourceHash,
        source_text_hash: sourceTextHash,
      } as HashedRenderedPageMap
    }

    // Browser layout is intentionally not promoted to an authoritative page
    // map: HTML cannot reproduce Word pagination exactly. Keep one auditable
    // whole-document range while the UI renders the original OOXML package.
    const pageMap: RenderedPageMap = {
      page_count: 1,
      locator: 'provisional',
      pages: [{
        page: 1,
        start: 0,
        end: Math.max(0, parsedText.length - 1),
        locator: 'provisional',
      }],
    }
    await persistPageMap(contract, source, sourceTextHash, pageMap, renderMode)
    return {
      ...pageMap,
      source_hash: sourceHash,
      source_text_hash: sourceTextHash,
    }
  }
  return (await renderContractSource(contract, options)).pageMap
}

/**
 * Prove that the text sent to an AI review is a deterministic projection of
 * the exact source bytes currently stored for the contract.
 *
 * PDF keeps the strict rendered-page requirement. DOCX/DOCM keeps its honest
 * browser-ooxml/provisional locator, but is reviewable after the OOXML body is
 * re-extracted from the same bytes and matches `parsed_text` exactly. Legacy
 * binary DOC has no safe server-side text projection and must be saved as
 * DOCX before AI review.
 */
export async function verifyContractReviewSource(contract: SourceContractRecord) {
  if (!contract.parsed_text?.trim()) throw new Error('当前源文件尚无可验证解析文本')
  const format = contractSourceFormatFromFilename(contract.filename)
  if (!format) throw new Error('无法识别源文件格式')
  if (format === 'doc') throw new Error('旧版 DOC 暂不支持 AI 审核，请先另存为 DOCX 后上传')

  const source = await downloadSource(contract)
  const sourceHash = createHash('sha256').update(source).digest('hex')
  const extractedText = format === 'pdf'
    ? await extractPdfText(source)
    : await extractCurrentWordText(source, format)
  if (extractedText !== contract.parsed_text) {
    throw new Error('当前源文件正文与数据库解析文本不一致')
  }
  const sourceTextHash = createHash('sha256').update(extractedText).digest('hex')
  const stored = await loadStoredContractPageMap(contract)

  if (format === 'pdf') {
    const storedMatchesSource = Boolean(
      stored?.source_hash === sourceHash
      && stored.source_text_hash === sourceTextHash
      && stored.render_mode === 'native-pdf'
      && stored.locator === 'rendered'
      && stored.page_count > 0
      && stored.pages.length === stored.page_count
    )
    const pageMap = storedMatchesSource && stored
      ? stored
      : await extractRenderedPageMap(source, extractedText)
    if (pageMap.locator !== 'rendered') {
      throw new Error('PDF 正文无法与当前源文件逐页对应')
    }
    if (!storedMatchesSource) await persistPageMap(contract, source, sourceTextHash, pageMap, 'native-pdf')
    return {
      ...pageMap,
      render_mode: 'native-pdf' as const,
      source_hash: sourceHash,
      source_text_hash: sourceTextHash,
    }
  }

  const storedMatchesSource = Boolean(
    stored?.source_hash === sourceHash
    && stored.source_text_hash === sourceTextHash
    && stored.render_mode === 'browser-ooxml'
    && stored.locator === 'provisional'
    && stored.page_count > 0
    && stored.pages.length === stored.page_count
  )
  const pageMap: RenderedPageMap = storedMatchesSource && stored
    ? stored
    : {
        page_count: 1,
        locator: 'provisional',
        pages: [{
          page: 1,
          start: 0,
          end: Math.max(0, extractedText.length - 1),
          locator: 'provisional',
        }],
      }
  if (!storedMatchesSource) await persistPageMap(contract, source, sourceTextHash, pageMap, 'browser-ooxml')
  return {
    ...pageMap,
    render_mode: 'browser-ooxml' as const,
    source_hash: sourceHash,
    source_text_hash: sourceTextHash,
  }
}
