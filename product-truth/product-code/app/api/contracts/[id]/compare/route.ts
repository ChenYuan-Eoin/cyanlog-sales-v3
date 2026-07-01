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
  compare_doc_id: z.string().uuid(),
})

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

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, '').toLowerCase()
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

function buildDiffRows(comparisonId: string, baselineText: string, compareText: string): DiffInsert[] {
  const baselineLines = splitComparableText(baselineText)
  const compareLines = splitComparableText(compareText)
  const baselineSet = new Set(baselineLines.map(normalizeLine))
  const compareSet = new Set(compareLines.map(normalizeLine))
  const rows: DiffInsert[] = []

  for (const line of baselineLines) {
    if (compareSet.has(normalizeLine(line))) continue
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

  for (const line of compareLines) {
    if (baselineSet.has(normalizeLine(line))) continue
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
    const [contract, compareContract] = await Promise.all([
      loadComparableContract(id, orgId, accessibleUserIds),
      loadComparableContract(parsed.data.compare_doc_id, orgId, accessibleUserIds),
    ])

    if (!contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在或无权访问'))
    }
    if (!compareContract) {
      return errorResponse(createApiError('NOT_FOUND', '对比合同不存在或无权访问'))
    }
    if (contract.id === compareContract.id) {
      return errorResponse(createApiError('VALIDATION_ERROR', '不能与同一份合同比对'))
    }
    if (!canCompareContracts(contract, compareContract)) {
      return errorResponse(createApiError(
        'VALIDATION_ERROR',
        '对比合同与当前合同缺少同客户、同报价或同上传者的关系，请选择同一客户/报价下的合同版本或重新上传新版本'
      ))
    }
    if (contract.status !== 'COMPLETED' || compareContract.status !== 'COMPLETED') {
      return errorResponse(createApiError('VALIDATION_ERROR', '只能比对已完成审核的合同'))
    }
    const [baselineResult, compareResult] = await Promise.all([
      ensureComparableText(contract),
      ensureComparableText(compareContract),
    ])

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
        baseline_doc_id: parsed.data.baseline_doc_id,
        compare_doc_id: parsed.data.compare_doc_id,
        status: 'pending',
      })
      .select()
      .single()

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '创建比对任务失败'))
    }

    const diffRows = buildDiffRows(comparison.id, baselineResult.contract.parsed_text, compareResult.contract.parsed_text)
    const summary = comparisonSummary(diffRows, contract.filename, compareContract.filename)
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

    if (comparison.compare_doc_id) {
      const [contract, compareContract] = await Promise.all([
        loadComparableContract(id, orgId, accessibleUserIds),
        loadComparableContract(comparison.compare_doc_id, orgId, accessibleUserIds),
      ])

      if (!contract || !compareContract || !canCompareContracts(contract, compareContract)) {
        return successResponse(null)
      }
    }

    return successResponse({
      ...comparison,
      diffs: comparison.comparison_diffs || [],
    })
  })
}
