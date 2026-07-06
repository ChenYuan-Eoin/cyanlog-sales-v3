// POST /api/contracts/:id/compare
// GET /api/contracts/:id/compare
// 文档比对 API

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { z } from 'zod'
import {
  errorResponse,
  createdResponse,
  successResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { listAccessibleUserIds } from '@/lib/scoped-access'
import { extractContractText } from '@/lib/contracts/text-extraction'

const compareSchema = z.object({
  baseline_type: z.enum(['template', 'previous_version', 'uploaded']),
  baseline_doc_id: z.string().uuid().optional(),
  compare_doc_id: z.string().uuid().optional(),
  compare_version_id: z.string().uuid().optional(),
  precision: z.enum(['strict', 'semantic']).default('semantic'),
  manual_confirmed: z.boolean().optional(),
}).refine((value) => Boolean(value.compare_doc_id || value.compare_version_id), {
  message: '必须选择对比合同或对比版本',
  path: ['compare_doc_id'],
})

type ComparePrecision = z.infer<typeof compareSchema>['precision']

type ComparableContract = {
  id: string
  filename: string | null
  status: string | null
  contract_no: string | null
  quote_id: string | null
  party_b_name: string | null
  parsed_text: string | null
  storage_path: string | null
  mime_type: string | null
  created_by: string
  org_id: string
}

type ComparableContractWithText = ComparableContract & {
  parsed_text: string
}

type ComparableVersion = {
  id: string
  contract_id: string
  version_number: number
  source: string
  storage_path: string
  file_size: number | null
  mime_type: string | null
  parent_version_id: string | null
  change_summary: string | null
  review_id: string | null
  created_at: string | null
}

type ComparisonDocumentMeta = {
  id: string | null
  label: string
  filename: string | null
  source: 'current_contract' | 'contract' | 'version' | 'unknown'
  source_label: string
  version_number?: number
  created_at?: string | null
}

type ComparableTextFailureReason = 'missing_source' | 'download_failed' | 'download_timeout' | 'extract_failed'

type ComparableTextResult =
  | { ok: true; contract: ComparableContractWithText }
  | { ok: false; contract: ComparableContract; reason: ComparableTextFailureReason }

type DiffInsert = {
  comparison_id: string
  diff_type: 'deleted' | 'added' | 'modified'
  baseline_text?: string
  compare_text?: string
  semantic_change: string
  risk_level: 'red' | 'yellow' | 'green'
  sort_order: number
}

const HIGH_RISK_TERMS = [
  '违约',
  '赔偿',
  '付款',
  '质保',
  '保证金',
  '解除',
  '终止',
  '知识产权',
  '保密',
  '管辖',
  '仲裁',
  '责任',
]

const TEXT_EXTRACTION_TIMEOUT_MS = 8000
const DOWNLOAD_TIMEOUT = Symbol('download-timeout')

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof DOWNLOAD_TIMEOUT> {
  return Promise.race([
    promise,
    new Promise<typeof DOWNLOAD_TIMEOUT>((resolve) => {
      setTimeout(() => resolve(DOWNLOAD_TIMEOUT), ms)
    }),
  ])
}

function splitComparableText(text: string): string[] {
  return text
    .replace(/\r/g, '\n')
    .split(/\n+|(?<=[。；;.!?？])\s*/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 6)
    .slice(0, 240)
}

function normalizeLine(line: string, precision: ComparePrecision = 'semantic'): string {
  if (precision === 'strict') return line.trim().toLowerCase()
  return line.replace(/\s+/g, '').toLowerCase()
}

function comparableBigrams(line: string, precision: ComparePrecision): string[] {
  const normalized = normalizeLine(line, precision)
  if (!normalized) return []
  if (normalized.length <= 2) return [normalized]

  const tokens: string[] = []
  for (let index = 0; index < normalized.length - 1; index += 1) {
    tokens.push(normalized.slice(index, index + 2))
  }
  return tokens
}

function lineSimilarity(left: string, right: string, precision: ComparePrecision): number {
  const leftTokens = comparableBigrams(left, precision)
  const rightTokens = comparableBigrams(right, precision)
  if (leftTokens.length === 0 || rightTokens.length === 0) return 0

  const rightCounts = new Map<string, number>()
  for (const token of rightTokens) {
    rightCounts.set(token, (rightCounts.get(token) || 0) + 1)
  }

  let overlap = 0
  for (const token of leftTokens) {
    const count = rightCounts.get(token) || 0
    if (count <= 0) continue
    overlap += 1
    rightCounts.set(token, count - 1)
  }

  return (overlap * 2) / (leftTokens.length + rightTokens.length)
}

function normalizeComparableField(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, '').toLowerCase()
}

function hasStructuredCompareIdentity(contract: ComparableContract): boolean {
  return Boolean(contract.quote_id || normalizeComparableField(contract.party_b_name))
}

function canCompareContracts(contract: ComparableContract, compareContract: ComparableContract): boolean {
  if (contract.id === compareContract.id) return false
  if (contract.org_id !== compareContract.org_id) return false

  if (contract.quote_id && compareContract.quote_id && contract.quote_id === compareContract.quote_id) {
    return true
  }

  const partyName = normalizeComparableField(contract.party_b_name)
  const comparePartyName = normalizeComparableField(compareContract.party_b_name)
  if (partyName && comparePartyName && partyName === comparePartyName) {
    return true
  }

  // Legacy uploads may lack quote/customer metadata. Keep them comparable only inside
  // the same uploader scope instead of mixing arbitrary completed contracts.
  if (!hasStructuredCompareIdentity(contract) && !hasStructuredCompareIdentity(compareContract)) {
    return contract.created_by === compareContract.created_by
  }

  return false
}

function inferRiskLevel(text: string): 'red' | 'yellow' | 'green' {
  if (!text.trim()) return 'green'
  return HIGH_RISK_TERMS.some((term) => text.includes(term)) ? 'red' : 'yellow'
}

function buildDiffRows(
  comparisonId: string,
  baselineText: string,
  compareText: string,
  precision: ComparePrecision = 'semantic'
): DiffInsert[] {
  const baselineLines = splitComparableText(baselineText)
  const compareLines = splitComparableText(compareText)
  const matchedCompareIndexes = new Set<number>()
  const unmatchedBaselineLines: string[] = []
  const rows: DiffInsert[] = []
  const similarLineThreshold = precision === 'strict' ? 0.72 : 0.5

  for (const line of baselineLines) {
    const exactIndex = compareLines.findIndex((compareLine, index) => (
      !matchedCompareIndexes.has(index) && normalizeLine(compareLine, precision) === normalizeLine(line, precision)
    ))

    if (exactIndex >= 0) {
      matchedCompareIndexes.add(exactIndex)
      continue
    }

    unmatchedBaselineLines.push(line)
  }

  for (const line of unmatchedBaselineLines) {
    let bestCompareIndex = -1
    let bestScore = 0

    compareLines.forEach((compareLine, index) => {
      if (matchedCompareIndexes.has(index)) return

      const score = lineSimilarity(line, compareLine, precision)
      if (score > bestScore) {
        bestScore = score
        bestCompareIndex = index
      }
    })

    if (bestCompareIndex >= 0 && bestScore >= similarLineThreshold) {
      const compareLine = compareLines[bestCompareIndex]
      matchedCompareIndexes.add(bestCompareIndex)
      rows.push({
        comparison_id: comparisonId,
        diff_type: 'modified',
        baseline_text: line,
        compare_text: compareLine,
        semantic_change: '同一条款疑似发生改写，需复核差异是否影响风险、责任或谈判边界',
        risk_level: inferRiskLevel(`${line}\n${compareLine}`),
        sort_order: rows.length + 1,
      })
      if (rows.length >= 50) return rows
      continue
    }

    rows.push({
      comparison_id: comparisonId,
      diff_type: 'deleted',
      baseline_text: line,
      semantic_change: '对比文档缺少该条款或表述已被删除',
      risk_level: inferRiskLevel(line),
      sort_order: rows.length + 1,
    })
    if (rows.length >= 50) return rows
  }

  for (const [index, line] of compareLines.entries()) {
    if (matchedCompareIndexes.has(index)) continue
    rows.push({
      comparison_id: comparisonId,
      diff_type: 'added',
      compare_text: line,
      semantic_change: '对比文档新增该条款或表述',
      risk_level: inferRiskLevel(line),
      sort_order: rows.length + 1,
    })
    if (rows.length >= 50) return rows
  }

  return rows
}

function comparisonSummary(diffRows: DiffInsert[], baselineName?: string | null, compareName?: string | null) {
  if (diffRows.length === 0) {
    return `未发现 ${baselineName || '当前合同'} 与 ${compareName || '对比合同'} 的明显文本差异。`
  }

  const red = diffRows.filter((row) => row.risk_level === 'red').length
  const yellow = diffRows.filter((row) => row.risk_level === 'yellow').length
  return `发现 ${diffRows.length} 处文本差异，其中高风险 ${red} 处、需关注 ${yellow} 处。`
}

async function loadComparableContract(id: string, orgId: string, accessibleUserIds: string[]) {
  const { data } = await supabaseAdmin
    .from('contracts')
    .select('id, filename, status, contract_no, quote_id, party_b_name, parsed_text, storage_path, mime_type, created_by, org_id')
    .eq('id', id)
    .eq('org_id', orgId)
    .in('created_by', accessibleUserIds)
    .maybeSingle()

  return data as ComparableContract | null
}

async function loadComparableVersions(contractId: string) {
  const { data } = await supabaseAdmin
    .from('contract_versions')
    .select('id, contract_id, version_number, source, storage_path, file_size, mime_type, parent_version_id, change_summary, review_id, created_at')
    .eq('contract_id', contractId)
    .order('version_number', { ascending: false })

  return (data || []) as ComparableVersion[]
}

function versionAsComparableContract(contract: ComparableContract, version: ComparableVersion): ComparableContract {
  return {
    ...contract,
    id: version.id,
    filename: `${contract.filename || '合同源文件'} v${version.version_number}`,
    parsed_text: null,
    storage_path: version.storage_path,
    mime_type: version.mime_type,
  }
}

type ResolvedBaselineSelection = {
  contract: ComparableContract
  relationContract: ComparableContract
  docId: string
  name: string | null
}

async function resolveBaselineSelection({
  preferredDocId,
  currentContract,
  currentVersions,
  orgId,
  accessibleUserIds,
}: {
  preferredDocId?: string | null
  currentContract: ComparableContract
  currentVersions: ComparableVersion[]
  orgId: string
  accessibleUserIds: string[]
}): Promise<ResolvedBaselineSelection | null> {
  if (!preferredDocId || preferredDocId === currentContract.id) {
    return {
      contract: currentContract,
      relationContract: currentContract,
      docId: currentContract.id,
      name: currentContract.filename ?? null,
    }
  }

  const baselineVersion = currentVersions.find((version) => version.id === preferredDocId)
  if (baselineVersion) {
    return {
      contract: versionAsComparableContract(currentContract, baselineVersion),
      relationContract: currentContract,
      docId: baselineVersion.id,
      name: `${currentContract.filename || '合同'} v${baselineVersion.version_number}`,
    }
  }

  const baselineContract = await loadComparableContract(preferredDocId, orgId, accessibleUserIds)
  if (!baselineContract) return null

  return {
    contract: baselineContract,
    relationContract: baselineContract,
    docId: baselineContract.id,
    name: baselineContract.filename ?? null,
  }
}

function selectBaselineVersion(versions: ComparableVersion[], compareVersion: ComparableVersion, preferredId?: string) {
  if (preferredId) {
    const preferred = versions.find((version) => version.id === preferredId)
    if (preferred && preferred.id !== compareVersion.id) return preferred
  }

  if (compareVersion.parent_version_id) {
    const parent = versions.find((version) => version.id === compareVersion.parent_version_id)
    if (parent) return parent
  }

  return versions.find((version) => (
    version.id !== compareVersion.id && version.source === 'original'
  )) || versions.find((version) => version.id !== compareVersion.id) || null
}

function versionDocumentMeta(
  contract: ComparableContract,
  version: ComparableVersion,
  sourceLabel: string
): ComparisonDocumentMeta {
  const baseName = contract.filename || '合同源文件'
  return {
    id: version.id,
    label: `${baseName} v${version.version_number}`,
    filename: baseName,
    source: 'version',
    source_label: sourceLabel,
    version_number: version.version_number,
    created_at: version.created_at,
  }
}

function contractDocumentMeta(
  contract: ComparableContract,
  source: ComparisonDocumentMeta['source'],
  sourceLabel: string
): ComparisonDocumentMeta {
  return {
    id: contract.id,
    label: contract.filename || contract.contract_no || '合同文件',
    filename: contract.filename,
    source,
    source_label: sourceLabel,
  }
}

async function resolveComparisonDocumentMeta({
  docId,
  currentContract,
  currentVersions,
  orgId,
  accessibleUserIds,
  fallbackSourceLabel,
  currentSourceLabel,
}: {
  docId: string | null
  currentContract: ComparableContract
  currentVersions: ComparableVersion[]
  orgId: string
  accessibleUserIds: string[]
  fallbackSourceLabel: string
  currentSourceLabel: string
}): Promise<ComparisonDocumentMeta> {
  if (!docId || docId === currentContract.id) {
    const originalVersion = currentVersions.find((version) => version.source === 'original')
    return originalVersion
      ? versionDocumentMeta(currentContract, originalVersion, currentSourceLabel)
      : contractDocumentMeta(currentContract, 'current_contract', currentSourceLabel)
  }

  const version = currentVersions.find((item) => item.id === docId)
  if (version) {
    return versionDocumentMeta(currentContract, version, fallbackSourceLabel)
  }

  const contract = await loadComparableContract(docId, orgId, accessibleUserIds)
  if (contract) {
    return contractDocumentMeta(contract, 'contract', fallbackSourceLabel)
  }

  return {
    id: docId,
    label: '未知文件',
    filename: null,
    source: 'unknown',
    source_label: fallbackSourceLabel,
  }
}

async function ensureComparableText(contract: ComparableContract): Promise<ComparableTextResult> {
  if (contract.parsed_text?.trim()) {
    return { ok: true, contract: { ...contract, parsed_text: contract.parsed_text } }
  }

  if (!contract.storage_path) {
    return { ok: false, contract, reason: 'missing_source' }
  }

  const downloadResult = await withTimeout(
    supabaseAdmin.storage.from('contracts').download(contract.storage_path),
    TEXT_EXTRACTION_TIMEOUT_MS
  )

  if (downloadResult === DOWNLOAD_TIMEOUT) {
    return { ok: false, contract, reason: 'download_timeout' }
  }

  if (downloadResult.error || !downloadResult.data) {
    return { ok: false, contract, reason: 'download_failed' }
  }

  let extractedText: string | null = null
  try {
    const fileBuffer = Buffer.from(await downloadResult.data.arrayBuffer())
    extractedText = extractContractText(
      fileBuffer,
      contract.filename || contract.storage_path,
      contract.mime_type || undefined
    )
  } catch {
    return { ok: false, contract, reason: 'extract_failed' }
  }

  if (!extractedText?.trim()) {
    return { ok: false, contract, reason: 'extract_failed' }
  }

  // Backfill best-effort. The compare can still proceed with extracted text if persistence fails.
  await supabaseAdmin
    .from('contracts')
    .update({
      parsed_text: extractedText,
      ocr_status: 'COMPLETED',
      ocr_result: {
        raw_text: extractedText,
        confidence: 0.8,
        source: 'compare-lazy-text-extraction',
        completed_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq('id', contract.id)
    .eq('org_id', contract.org_id)

  return { ok: true, contract: { ...contract, parsed_text: extractedText } }
}

function comparableTextFailureMessage(result: ComparableTextResult) {
  if (result.ok) return '合同缺少可比对的解析文本'

  const name = result.contract.filename || '所选合同'
  switch (result.reason) {
    case 'missing_source':
      return `${name} 缺少源文件和可比对的解析文本`
    case 'download_timeout':
      return `${name} 源文件读取超时，请稍后重试或重新上传`
    case 'download_failed':
      return `${name} 源文件读取失败，请检查文件是否仍存在`
    case 'extract_failed':
      return `${name} 无法提取可比对文本，请上传可复制文本的 docx/pdf`
  }
}

// POST - 发起比对
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = compareSchema.safeParse(body)

    if (!parsed.success) {
      return errorResponse(
        createApiError('VALIDATION_ERROR', '参数验证失败')
      )
    }

    const { userIds: accessibleUserIds } = await listAccessibleUserIds(user.id, orgId)
    const contract = await loadComparableContract(id, orgId, accessibleUserIds)

    if (!contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在或无权访问'))
    }

    let baselineDocId = parsed.data.baseline_doc_id || null
    let compareDocId = parsed.data.compare_doc_id || null
    let baselineName = contract.filename
    let compareName: string | null | undefined = null
    let baselineResult: ComparableTextResult
    let compareResult: ComparableTextResult

    if (parsed.data.compare_version_id) {
      const versions = await loadComparableVersions(id)
      const compareVersion = versions.find((version) => version.id === parsed.data.compare_version_id)
      if (!compareVersion) {
        return errorResponse(createApiError('NOT_FOUND', '对比版本不存在或不属于当前合同'))
      }

      const baselineVersion = selectBaselineVersion(versions, compareVersion, parsed.data.baseline_doc_id)
      if (!baselineVersion) {
        return errorResponse(createApiError('VALIDATION_ERROR', '当前合同缺少可作为基准的历史版本'))
      }

      baselineDocId = baselineVersion.id
      compareDocId = compareVersion.id
      baselineName = `${contract.filename || '合同'} v${baselineVersion.version_number}`
      compareName = `${contract.filename || '合同'} v${compareVersion.version_number}`

      const [baselineVersionResult, compareVersionResult] = await Promise.all([
        ensureComparableText(versionAsComparableContract(contract, baselineVersion)),
        ensureComparableText(versionAsComparableContract(contract, compareVersion)),
      ])
      baselineResult = baselineVersionResult
      compareResult = compareVersionResult
    } else {
      const currentVersions = parsed.data.baseline_doc_id
        ? await loadComparableVersions(id)
        : []
      const baselineSelection = await resolveBaselineSelection({
        preferredDocId: parsed.data.baseline_doc_id,
        currentContract: contract,
        currentVersions,
        orgId,
        accessibleUserIds,
      })
      if (!baselineSelection) {
        return errorResponse(createApiError('NOT_FOUND', '旧文件不存在或无权访问'))
      }

      const compareContract = await loadComparableContract(parsed.data.compare_doc_id as string, orgId, accessibleUserIds)
      if (!compareContract) {
        return errorResponse(createApiError('NOT_FOUND', '对比合同不存在或无权访问'))
      }
      if (baselineSelection.contract.id === compareContract.id) {
        return errorResponse(createApiError('VALIDATION_ERROR', '不能与同一份合同比对；请选择版本流中的客户回传版本'))
      }
      if (!canCompareContracts(baselineSelection.relationContract, compareContract) && !parsed.data.manual_confirmed) {
        return errorResponse(createApiError(
          'VALIDATION_ERROR',
          '对比合同与基准合同缺少同客户、同报价或同上传者的关系，请选择同一客户/报价下的合同版本，或人工确认两份文件属于同一业务对比'
        ))
      }
      if (baselineSelection.contract.status !== 'COMPLETED' || compareContract.status !== 'COMPLETED') {
        return errorResponse(createApiError('VALIDATION_ERROR', '只能比对已完成审核的合同'))
      }
      baselineDocId = baselineSelection.docId
      baselineName = baselineSelection.name
      compareName = compareContract.filename
      const [contractResult, compareContractResult] = await Promise.all([
        ensureComparableText(baselineSelection.contract),
        ensureComparableText(compareContract),
      ])
      baselineResult = contractResult
      compareResult = compareContractResult
    }

    if (!baselineResult.ok || !compareResult.ok) {
      return errorResponse(createApiError(
        'VALIDATION_ERROR',
        comparableTextFailureMessage(!baselineResult.ok ? baselineResult : compareResult)
      ))
    }

    const { data: comparison, error } = await supabaseAdmin
      .from('contract_comparisons')
      .insert({
        contract_id: id,
        created_by: user.id,
        baseline_type: parsed.data.baseline_type,
        baseline_doc_id: baselineDocId,
        compare_doc_id: compareDocId,
        status: 'pending',
      })
      .select()
      .single()

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '创建比对任务失败'))
    }

    const diffRows = buildDiffRows(
      comparison.id,
      baselineResult.contract.parsed_text,
      compareResult.contract.parsed_text,
      parsed.data.precision
    )
    const summary = comparisonSummary(diffRows, baselineName, compareName)
    const recommendation = diffRows.some((row) => row.risk_level === 'red')
      ? '存在高风险差异，建议法务复核后再签署。'
      : '未发现高风险差异，可按内部流程继续复核。'

    const { error: updateError } = await supabaseAdmin
      .from('contract_comparisons')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        ai_summary: summary,
        ai_recommendation: recommendation,
      })
      .eq('id', comparison.id)

    if (updateError) {
      return errorResponse(createApiError('DB_ERROR', '更新比对任务失败'))
    }

    if (diffRows.length > 0) {
      const { error: diffError } = await supabaseAdmin.from('comparison_diffs').insert(diffRows)
      if (diffError) {
        return errorResponse(createApiError('DB_ERROR', '保存比对差异失败'))
      }
    }

    return createdResponse({
      ...comparison,
      status: 'completed',
      ai_summary: summary,
      ai_recommendation: recommendation,
      diffs: diffRows,
    })
  })
}

// GET - 查询比对结果
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params
    const { searchParams } = new URL(req.url)
    const comparisonId = searchParams.get('comparison_id')
    const { userIds: accessibleUserIds } = await listAccessibleUserIds(user.id, orgId)

    let query = supabaseAdmin
      .from('contract_comparisons')
      .select(`
        *,
        contracts!inner(id, org_id, created_by),
        comparison_diffs(id, diff_type, baseline_text, compare_text, semantic_change, risk_level, sort_order)
      `)
      .eq('contract_id', id)
      .eq('contracts.org_id', orgId)
      .in('contracts.created_by', accessibleUserIds)
      .order('created_at', { ascending: false })
      .limit(1)

    if (comparisonId) {
      query = query.eq('id', comparisonId)
    }

    const { data: comparisons, error } = await query

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '查询比对结果失败'))
    }

    const comparison = comparisons?.[0]

    if (!comparison) {
      return successResponse(null)
    }

    const contract = await loadComparableContract(id, orgId, accessibleUserIds)
    if (!contract) {
      return successResponse(null)
    }

    const versions = await loadComparableVersions(id)
    if (comparison.compare_doc_id) {
      const compareContract = await loadComparableContract(comparison.compare_doc_id, orgId, accessibleUserIds)
      if (compareContract) {
        let baselineRelationContract = contract
        if (comparison.baseline_doc_id && comparison.baseline_doc_id !== contract.id) {
          const baselineVersion = versions.find((version) => version.id === comparison.baseline_doc_id)
          if (!baselineVersion) {
            const baselineContract = await loadComparableContract(comparison.baseline_doc_id, orgId, accessibleUserIds)
            if (!baselineContract) {
              return successResponse(null)
            }
            baselineRelationContract = baselineContract
          }
        }
        if (!comparison.baseline_doc_id && !canCompareContracts(baselineRelationContract, compareContract)) {
          return successResponse(null)
        }
      } else {
        const compareVersion = versions.find((version) => version.id === comparison.compare_doc_id)
        if (!compareVersion) {
          return successResponse(null)
        }
      }
    }

    const [baselineMeta, compareMeta] = await Promise.all([
      resolveComparisonDocumentMeta({
        docId: comparison.baseline_doc_id || null,
        currentContract: contract,
        currentVersions: versions,
        orgId,
        accessibleUserIds,
        fallbackSourceLabel: '基准版本',
        currentSourceLabel: '当前合同',
      }),
      resolveComparisonDocumentMeta({
        docId: comparison.compare_doc_id || null,
        currentContract: contract,
        currentVersions: versions,
        orgId,
        accessibleUserIds,
        fallbackSourceLabel: '新版/客户回传',
        currentSourceLabel: '当前合同',
      }),
    ])

    return successResponse({
      ...comparison,
      document_pair: {
        baseline: baselineMeta,
        compare: compareMeta,
      },
      diffs: comparison.comparison_diffs || [],
    })
  })
}
