import { NextRequest } from 'next/server'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { createdResponse, errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { ensureContractPageMap } from '@/lib/documents/source-render-server'
import { extractPdfText } from '@/lib/documents/source-render'
import { extractCurrentWordText } from '@/lib/documents/source-text'
import { contractSourceFormatFromFilename } from '@/lib/documents/source-format'
import { buildDocumentDiff, type DocumentDiffPosition } from '@/lib/contracts/document-diff'
import {
  cleanupUnreferencedFrozenSources,
  loadFrozenComparisonSource,
  type FrozenComparisonPageMap,
  type FrozenComparisonSource,
  type FrozenSourceCleanupResult,
} from '@/lib/contracts/comparison-snapshot-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const compareSchema = z.object({
  baseline_type: z.enum(['template', 'previous_version', 'uploaded']).default('uploaded'),
  baseline_doc_id: z.string().uuid().optional(),
  compare_doc_id: z.string().uuid(),
})

interface ContractRow {
  id: string
  org_id: string
  filename: string
  storage_path: string | null
  size: number | null
  mime_type: string | null
  parsed_text: string | null
}

interface RpcSnapshot {
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
  page_map: FrozenComparisonPageMap['pages']
}

interface PreparedSnapshot extends Omit<RpcSnapshot, 'storage_path'> {
  bytes: Buffer
}

class FrozenSourceMaterializationError extends Error {
  constructor(
    message: string,
    readonly storagePath: string,
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'FrozenSourceMaterializationError'
  }
}

class ComparisonCreationError extends Error {
  constructor(
    message: string,
    readonly stage: 'diff' | 'rpc',
    cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'ComparisonCreationError'
  }
}

const CRITICAL_TERMS = [
  '付款', '账期', '逾期', '违约', '赔偿', '责任', '终止', '退款',
  '知识产权', '源代码', '保密', '争议', '管辖', '验收', '税率', '金额',
]

function riskForDiff(text: string, type: 'added' | 'deleted' | 'modified') {
  const critical = CRITICAL_TERMS.some((term) => text.includes(term))
  if (critical && type !== 'added') return 'red' as const
  if (critical) return 'yellow' as const
  return 'green' as const
}

function semanticChange(type: 'added' | 'deleted' | 'modified', text: string) {
  const terms = CRITICAL_TERMS.filter((term) => text.includes(term)).slice(0, 3)
  const scope = terms.length ? `，涉及${terms.join('、')}` : ''
  if (type === 'added') return `新文件新增了该原文范围${scope}`
  if (type === 'deleted') return `新文件删除了该原文范围${scope}`
  return `旧/新文件在该原文范围存在修改${scope}`
}

function positionInPageMap(pageMap: FrozenComparisonPageMap, position: DocumentDiffPosition) {
  const point = position.start_offset_utf16
  const rangeEnd = Math.max(point, position.end_offset_utf16 - 1)
  const page = pageMap.pages.find((entry) => entry.start <= point && entry.end >= rangeEnd)
    || pageMap.pages.find((entry) => entry.start <= point && entry.end >= point)
    || pageMap.pages[Math.min(pageMap.pages.length - 1, Math.max(0, Math.floor(position.normalized_progress * pageMap.pages.length)))]
  if (!page) throw new Error('差异位置无法绑定冻结页级映射')
  const lineBoxes = page.line_boxes?.filter((box) => (
    position.end_offset_utf16 > position.start_offset_utf16
      ? box.end >= position.start_offset_utf16 && box.start < position.end_offset_utf16
      : box.start <= point && box.end >= point
  )).map(({ left, top, width, height, start, end, text }) => ({ left, top, width, height, start, end, text })) || []

  return {
    page: page.page,
    start: position.start_offset_utf16,
    end: position.end_offset_utf16,
    start_offset_utf16: position.start_offset_utf16,
    end_offset_utf16: position.end_offset_utf16,
    start_line: position.start_line,
    end_line: position.end_line,
    progress: position.normalized_progress,
    normalized_progress: position.normalized_progress,
    page_progress: Math.max(0, Math.min(1, (
      point - page.start
    ) / Math.max(1, page.end - page.start + 1))),
    locator: page.locator,
    line_boxes: lineBoxes,
  }
}

async function prepareCurrentSource(contractId: string, orgId: string): Promise<PreparedSnapshot> {
  const { data, error } = await supabaseAdmin
    .from('contracts')
    .select('id,org_id,filename,storage_path,size,mime_type,parsed_text')
    .eq('id', contractId)
    .eq('org_id', orgId)
    .maybeSingle()
  if (error) throw new Error('合同源文件查询失败')
  const contract = data as ContractRow | null
  if (!contract?.storage_path || !contract.filename || !contract.mime_type || !contract.size) {
    throw new Error('合同缺少可冻结的源文件身份')
  }
  const format = contractSourceFormatFromFilename(contract.filename)
  if (format === 'doc') throw new Error('旧版 DOC 不进入原文级对比，请先在 Word/WPS 另存为 DOCX')
  if (format !== 'docx' && format !== 'docm' && format !== 'pdf') {
    throw new Error('G6 当前只支持 DOCX、DOCM 和 PDF 原文件对比')
  }

  const { data: sourceBlob, error: sourceError } = await supabaseAdmin.storage
    .from('contracts')
    .download(contract.storage_path)
  if (sourceError || !sourceBlob) throw new Error('合同源文件下载失败')
  const bytes = Buffer.from(await sourceBlob.arrayBuffer())
  const declaredSize = Number(contract.size)
  if (!Number.isSafeInteger(declaredSize) || bytes.byteLength !== declaredSize) {
    throw new Error('合同源文件大小与数据库身份不一致')
  }
  const sourceHash = createHash('sha256').update(bytes).digest('hex')
  const extractedText = format === 'pdf'
    ? await extractPdfText(bytes)
    : await extractCurrentWordText(bytes, format)
  const textReliability = extractedText.trim() ? 'verified' as const : 'unavailable' as const
  if (
    textReliability === 'verified'
    && extractedText !== (contract.parsed_text || '')
  ) {
    throw new Error('当前源文件正文与数据库解析文本不一致')
  }
  const authoritativeText = textReliability === 'verified' ? extractedText : ''

  const pageMap = await ensureContractPageMap({
    id: contract.id,
    filename: contract.filename,
    mime_type: contract.mime_type,
    storage_path: contract.storage_path,
    parsed_text: authoritativeText,
  }, { forceSourceVerification: true })
  if (!pageMap.source_hash || !pageMap.source_text_hash || pageMap.pages.length < 1) {
    throw new Error('合同源文件缺少可审计 SHA 或页级映射')
  }
  const textHash = createHash('sha256').update(authoritativeText).digest('hex')
  if (pageMap.source_hash !== sourceHash || pageMap.source_text_hash !== textHash) {
    throw new Error('合同源文件、正文与页级映射身份不一致')
  }

  return {
    contract_id: contract.id,
    origin_storage_path: contract.storage_path,
    file_name: contract.filename,
    file_size: declaredSize,
    mime_type: contract.mime_type,
    file_sha256: sourceHash,
    text_sha256: textHash,
    parsed_text: authoritativeText,
    text_reliability: textReliability,
    render_mode: format === 'pdf' ? 'native-pdf' : 'browser-ooxml',
    page_map: pageMap.pages,
    bytes,
  }
}

async function materializeFrozenSource(
  prepared: PreparedSnapshot,
  role: 'old' | 'new',
  orgId: string,
): Promise<RpcSnapshot> {
  const safeName = prepared.file_name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'source.bin'
  const storagePath = `g6-frozen/${orgId}/${randomUUID()}/${role}-${prepared.file_sha256}-${safeName}`
  try {
    const { error: uploadError } = await supabaseAdmin.storage
      .from('contracts')
      .upload(storagePath, prepared.bytes, {
        contentType: prepared.mime_type,
        upsert: false,
      })
    if (uploadError) throw new Error('冻结原文件副本保存失败')

    const { data: copiedBlob, error: copyError } = await supabaseAdmin.storage
      .from('contracts')
      .download(storagePath, { cacheNonce: randomUUID() }, { cache: 'no-store' })
    const copied = copiedBlob ? Buffer.from(await copiedBlob.arrayBuffer()) : null
    if (
      copyError
      || !copied
      || copied.byteLength !== prepared.file_size
      || createHash('sha256').update(copied).digest('hex') !== prepared.file_sha256
    ) throw new Error('冻结原文件副本回读校验失败')

    const { bytes: _bytes, ...identity } = prepared
    return { ...identity, storage_path: storagePath }
  } catch (error) {
    throw new FrozenSourceMaterializationError(
      error instanceof Error ? error.message : '冻结原文件副本保存失败',
      storagePath,
      error,
    )
  }
}

function publicCleanupDetails(cleanup: FrozenSourceCleanupResult) {
  return {
    cleanup_status: cleanup.status,
    cleanup_requested_count: cleanup.requested_count,
    cleanup_referenced_count: cleanup.referenced_count,
    cleanup_removed_count: cleanup.removed_count,
    cleanup_retained_count: cleanup.retained_count,
  }
}

function publicSource(source: FrozenComparisonSource) {
  const { parsed_text: _text, origin_storage_path: _originPath, ...identity } = source
  return identity
}

async function comparisonPayload(comparisonId: string, orgId: string) {
  const [{ data: comparison, error }, { data: diffs, error: diffsError }, oldSource, newSource] = await Promise.all([
    supabaseAdmin
      .from('contract_comparisons')
      .select('id,org_id,contract_id,created_by,baseline_type,baseline_doc_id,compare_doc_id,ai_summary,ai_recommendation,status,error_message,created_at,completed_at')
      .eq('id', comparisonId)
      .eq('org_id', orgId)
      .maybeSingle(),
    supabaseAdmin
      .from('comparison_diffs')
      .select('id,comparison_id,diff_type,baseline_position,compare_position,baseline_text,compare_text,semantic_change,risk_level,sort_order,created_at')
      .eq('comparison_id', comparisonId)
      .order('sort_order', { ascending: true }),
    loadFrozenComparisonSource(comparisonId, 'old', orgId),
    loadFrozenComparisonSource(comparisonId, 'new', orgId),
  ])
  if (error || diffsError) throw new Error('比对结果查询失败')
  if (!comparison || !oldSource || !newSource) return null
  return {
    ...comparison,
    sources: { old: publicSource(oldSource), new: publicSource(newSource) },
    diffs: diffs || [],
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params
    const parsed = compareSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) return errorResponse(createApiError('VALIDATION_ERROR', '参数验证失败'))
    const oldContractId = parsed.data.baseline_doc_id || id
    const newContractId = parsed.data.compare_doc_id
    if (oldContractId === newContractId) {
      return errorResponse(createApiError('VALIDATION_ERROR', '旧文件和新文件必须是两个独立源文件'))
    }

    let oldPrepared: PreparedSnapshot
    let newPrepared: PreparedSnapshot
    try {
      ;[oldPrepared, newPrepared] = await Promise.all([
        prepareCurrentSource(oldContractId, orgId),
        prepareCurrentSource(newContractId, orgId),
      ])
    } catch (sourceError) {
      return errorResponse(createApiError(
        'BUSINESS_RULE_VIOLATION',
        sourceError instanceof Error ? sourceError.message : '旧/新原文件身份无法冻结',
      ), 422)
    }

    const materialized = await Promise.allSettled([
      materializeFrozenSource(oldPrepared, 'old', orgId),
      materializeFrozenSource(newPrepared, 'new', orgId),
    ])
    const candidateCopies = materialized.flatMap((result) => {
      if (result.status === 'fulfilled') return [result.value.storage_path]
      return result.reason instanceof FrozenSourceMaterializationError
        ? [result.reason.storagePath]
        : []
    })
    if (materialized.some((result) => result.status === 'rejected')) {
      const cleanup = await cleanupUnreferencedFrozenSources(candidateCopies)
      return errorResponse(createApiError(
        'SERVICE_UNAVAILABLE',
        '冻结旧/新原文件副本失败，请重试',
        publicCleanupDetails(cleanup),
      ))
    }
    const [oldSource, newSource] = materialized.map((result) => (
      result as PromiseFulfilledResult<RpcSnapshot>
    ).value)

    let readable = false
    let summary = ''
    let comparisonId: string | null = null
    try {
      let diffRows
      try {
        readable = oldSource.text_reliability === 'verified'
          && newSource.text_reliability === 'verified'
        diffRows = readable
          ? buildDocumentDiff(oldSource.parsed_text, newSource.parsed_text).map((diff) => {
              const evidence = `${diff.baseline_text}\n${diff.compare_text}`
              return {
                diff_type: diff.diff_type,
                baseline_text: diff.baseline_text,
                compare_text: diff.compare_text,
                baseline_position: positionInPageMap({
                  page_count: oldSource.page_map.length,
                  locator: oldSource.page_map.every((page) => page.locator === 'rendered') ? 'rendered' : 'provisional',
                  pages: oldSource.page_map,
                }, diff.baseline_position),
                compare_position: positionInPageMap({
                  page_count: newSource.page_map.length,
                  locator: newSource.page_map.every((page) => page.locator === 'rendered') ? 'rendered' : 'provisional',
                  pages: newSource.page_map,
                }, diff.compare_position),
                semantic_change: semanticChange(diff.diff_type, evidence),
                risk_level: riskForDiff(evidence, diff.diff_type),
              }
            })
          : []
        const redCount = diffRows.filter((diff) => diff.risk_level === 'red').length
        const yellowCount = diffRows.filter((diff) => diff.risk_level === 'yellow').length
        summary = readable
          ? diffRows.length
            ? `发现 ${diffRows.length} 处冻结原文差异，其中红线 ${redCount} 处、需关注 ${yellowCount} 处。`
            : '两份冻结原文未发现可报告文本差异。'
          : '至少一份 PDF 没有可靠文本层；两份原文件已冻结并可预览，但差异和报告已明确停止。'
      } catch (error) {
        throw new ComparisonCreationError('冻结原文差异定位失败', 'diff', error)
      }

      let createResult: Awaited<ReturnType<typeof supabaseAdmin.rpc>>
      try {
        createResult = await supabaseAdmin.rpc('create_contract_comparison_v1', {
          p_org_id: orgId,
          p_created_by: user.id,
          p_baseline_type: parsed.data.baseline_type,
          p_old_source: oldSource,
          p_new_source: newSource,
          p_diffs: diffRows,
          p_ai_summary: summary,
          p_ai_recommendation: null,
        })
      } catch (error) {
        throw new ComparisonCreationError('创建不可变文档比对失败', 'rpc', error)
      }
      if (createResult.error || typeof createResult.data !== 'string') {
        throw new ComparisonCreationError('创建不可变文档比对失败', 'rpc', createResult.error)
      }
      comparisonId = createResult.data
    } catch (error) {
      const cleanup = await cleanupUnreferencedFrozenSources([
        oldSource.storage_path,
        newSource.storage_path,
      ])
      const recoveredComparisonId = cleanup.comparison_ids.length === 1
        ? cleanup.comparison_ids[0]
        : null
      if (recoveredComparisonId) {
        return errorResponse(createApiError(
          'CONFLICT',
          '比对可能已创建，但创建响应未能确认；请按 comparison_id 恢复',
          {
            comparison_id: recoveredComparisonId,
            ...publicCleanupDetails(cleanup),
          },
        ), 409)
      }
      const creationError = error instanceof ComparisonCreationError ? error : null
      return errorResponse(createApiError(
        creationError?.stage === 'rpc' ? 'DB_ERROR' : 'INTERNAL_ERROR',
        creationError?.message || '创建不可变文档比对失败',
        publicCleanupDetails(cleanup),
      ))
    }

    if (!readable) {
      return createdResponse({
        id: comparisonId,
        status: 'failed',
        error_message: summary,
        degraded: true,
      })
    }

    let payload
    try {
      payload = await comparisonPayload(comparisonId, orgId)
    } catch {
      return errorResponse(createApiError(
        'CONFLICT',
        '比对已创建但冻结快照读取失败；请按 comparison_id 恢复',
        { comparison_id: comparisonId },
      ), 409)
    }
    if (!payload) {
      return errorResponse(createApiError(
        'CONFLICT',
        '比对已创建但冻结快照读取失败；请按 comparison_id 恢复',
        { comparison_id: comparisonId },
      ), 409)
    }
    return createdResponse(payload)
  })
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { id } = await params
    const { data: latest, error } = await supabaseAdmin
      .from('contract_comparisons')
      .select('id')
      .eq('contract_id', id)
      .eq('org_id', orgId)
      .eq('source_snapshot_version', 1)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) return errorResponse(createApiError('DB_ERROR', '查询比对结果失败'))
    if (!latest) return errorResponse(createApiError('NOT_FOUND', '没有可审计的比对记录'))
    const payload = await comparisonPayload(latest.id, orgId)
    if (!payload) return errorResponse(createApiError('CONFLICT', '比对记录缺少旧/新冻结快照'), 409)
    return successResponse(payload)
  })
}
