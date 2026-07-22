// REQ:F007
// PURPOSE: Export contract review results as Word document with comments

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { generateWordDocument } from '@/lib/export/word-generator'
import { generateAnnotatedPdf } from '@/lib/export/pdf-annotator'
import { contractSourceFormatFromFilename } from '@/lib/documents/source-format'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getRequestId, logRouteDone, logRouteFailure, logRouteStart } from '@/lib/observability'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'
import { z } from 'zod'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

function buildDownloadName(filename: string | null | undefined, extension: 'docx' | 'docm' | 'pdf') {
  const base = (filename || 'contract').replace(/\.(doc|docx|docm|pdf)$/i, '')
  return `${base}-ONES批注版.${extension}`
}

const exportRequestSchema = z.object({
  export_mode: z.literal('source_annotated').optional(),
  source_identity: z.object({
    storage_path: z.string().min(1),
    source_hash: z.string().regex(/^[0-9a-f]{64}$/),
    source_text_hash: z.string().regex(/^[0-9a-f]{64}$/),
  }),
})

// POST /api/contracts/:id/export - 导出带批注的Word文档
export async function POST(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  const startedAt = Date.now()
  const requestId = getRequestId(req)
  const route = '/api/contracts/[id]/export'
  let routeId = ''

  try {
    const user = await requireAuth(req)
    const parsedBody = exportRequestSchema.safeParse(await req.json().catch(() => ({})))
    if (!parsedBody.success) {
      return errorResponse('导出必须携带页面已加载的完整源文件身份', 400, 'SOURCE_IDENTITY_REQUIRED')
    }
    const body = parsedBody.data
    const exportMode = body.export_mode || 'source_annotated'
    if (exportMode !== 'source_annotated') {
      return errorResponse('当前客户交付接口只允许导出源文件批注版', 400, 'UNSUPPORTED_EXPORT_MODE')
    }
    const orgId = await getDefaultOrgId(user.id)
    const { userIds: accessibleUserIds } = await listAccessibleUserIds(user.id, orgId)
    routeId = await resolveIdParam(params)
    const id = routeId
    logRouteStart({
      route,
      requestId,
      userId: user.id,
      details: { contractId: id },
    })

    if (!id) {
      return errorResponse('合同ID必填', 400, 'MISSING_ID')
    }

    // 获取合同和审核结果
    const { data: contract, error: contractError } = await supabaseAdmin
      .from('contracts')
      .select('*, contract_reviews(*)')
      .eq('id', id)
      .eq('org_id', orgId)
      .in('created_by', accessibleUserIds)
      .maybeSingle()

    if (contractError || !contract) {
      return errorResponse('合同不存在', 404, 'NOT_FOUND')
    }

    if (Array.isArray(contract.contract_reviews)) {
      contract.contract_reviews = contract.contract_reviews.sort((
        a: { created_at: string },
        b: { created_at: string }
      ) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
    }

    const latestReview = contract.contract_reviews?.[0]
    if (!contract.storage_path) {
      return errorResponse('合同源文件缺失，不能生成源文件批注版', 422, 'MISSING_SOURCE_FILE')
    }

    const sourceFormat = contractSourceFormatFromFilename(contract.filename || contract.storage_path)
    if (sourceFormat === 'doc') {
      return errorResponse('旧版 DOC 可以保留原件并用于审阅预览；生成 AI 原生批注版前请先另存为 DOCX。系统不会静默转换或重建原文', 422, 'LEGACY_DOC_REQUIRES_DOCX')
    }
    if (sourceFormat !== 'docx' && sourceFormat !== 'docm' && sourceFormat !== 'pdf') {
      return errorResponse('当前源文件不是受支持的 Word/PDF 格式', 422, 'UNSUPPORTED_SOURCE_FORMAT')
    }

    const [annotationResult, decisionResult, identityResult, fileResult] = await Promise.all([
      supabaseAdmin
        .from('contract_annotations')
        .select('id, start_offset, end_offset, selected_text, comment, category, priority, status, author_id, created_at, source_anchor, source_storage_path, source_hash, source_text_hash')
        .eq('contract_id', id)
        .eq('source_storage_path', contract.storage_path)
        .not('source_anchor', 'is', null)
        .order('created_at', { ascending: true }),
      supabaseAdmin
        .from('contract_review_decision_drafts')
        .select('risk_id,source_anchor,customer_comment,revision_text,negotiation_result,resolution_strategy_snapshot,status,workflow_state,source_storage_path,source_hash,source_text_hash,submitted_at')
        .eq('contract_id', id)
        .eq('status', 'batch_submitted')
        .eq('workflow_state', 'REVIEW_PASSED')
        .order('submitted_at', { ascending: true }),
      supabaseAdmin
        .from('contract_source_page_maps')
        .select('storage_path,source_hash,source_text_hash')
        .eq('contract_id', id)
        .eq('storage_path', contract.storage_path)
        .maybeSingle(),
      supabaseAdmin.storage.from('contracts').download(contract.storage_path),
    ])

    if (annotationResult.error) {
      return errorResponse('读取当前源文件人工批注失败', 500, 'ANNOTATION_LOAD_FAILED')
    }
    if (decisionResult.error) {
      return errorResponse('读取已通过批注决策失败', 500, 'DECISION_LOAD_FAILED')
    }
    if (identityResult.error || !identityResult.data?.source_hash || !identityResult.data.source_text_hash) {
      return errorResponse('当前源文件缺少可审计字节或解析文本哈希，不能安全导出', 409, 'SOURCE_IDENTITY_MISSING')
    }
    if (fileResult.error || !fileResult.data) {
      console.error('Download file error:', fileResult.error)
      return errorResponse('合同源文件下载失败，不能生成源文件批注版', 502, 'SOURCE_DOWNLOAD_FAILED')
    }

    const buffer = Buffer.from(await fileResult.data.arrayBuffer())
    const actualSourceHash = createHash('sha256').update(buffer).digest('hex')
    const actualSourceTextHash = createHash('sha256').update(contract.parsed_text || '').digest('hex')
    if (identityResult.data.source_hash !== actualSourceHash) {
      return errorResponse('当前存储文件与页级身份哈希冲突，已停止导出', 409, 'SOURCE_IDENTITY_CONFLICT')
    }
    if (identityResult.data.source_text_hash !== actualSourceTextHash) {
      return errorResponse('当前解析文本与页级身份哈希冲突，已停止导出', 409, 'SOURCE_TEXT_IDENTITY_CONFLICT')
    }
    if (
      body.source_identity.storage_path !== contract.storage_path
      || body.source_identity.source_hash !== actualSourceHash
      || body.source_identity.source_text_hash !== actualSourceTextHash
    ) {
      return errorResponse('页面加载后合同源文件已变化，请刷新后重新导出', 409, 'STALE_BROWSER_SOURCE_IDENTITY')
    }

    const annotations = (annotationResult.data || []).filter((annotation) => (
      annotation.source_storage_path === contract.storage_path
      && annotation.source_hash === actualSourceHash
      && annotation.source_text_hash === actualSourceTextHash
    ))
    const allPassedDecisions = decisionResult.data || []
    const decisionDrafts = allPassedDecisions.filter((decision) => (
      decision.source_storage_path === contract.storage_path
      && decision.source_hash === actualSourceHash
      && decision.source_text_hash === actualSourceTextHash
    ))
    if (decisionDrafts.length === 0 && annotations.length === 0) {
      return errorResponse('没有已通过决策或当前源文件的人工批注，不能导出批注版', 409, 'NO_SOURCE_ANNOTATIONS')
    }

    const exportData = {
      risks: [],
      annotations,
      export_mode: exportMode,
      decision_drafts: decisionDrafts,
    }

    const inputPath = path.join(os.tmpdir(), `contract-${id}-${randomUUID()}.${sourceFormat}`)
    let outputPath: string | undefined
    fs.writeFileSync(inputPath, buffer, { mode: 0o600 })
    try {
      const exportResult = sourceFormat === 'pdf'
        ? await generateAnnotatedPdf(inputPath, exportData)
        : await generateWordDocument(inputPath, exportData)

      outputPath = exportResult.outputPath
      if (!exportResult.success || !outputPath || !fs.existsSync(outputPath)) {
        const errorCode = 'errorCode' in exportResult && typeof exportResult.errorCode === 'string'
          ? exportResult.errorCode
          : 'EXPORT_FAILED'
        return errorResponse(
          exportResult.error || '文档生成失败',
          500,
          errorCode
        )
      }
      if (exportResult.unlocated?.length) {
        return errorResponse(
          `有 ${exportResult.unlocated.length} 条批注缺少可审计定位，已停止生成客户文件`,
          409,
          'ANNOTATION_ANCHOR_UNLOCATED'
        )
      }

      const fileBuffer = fs.readFileSync(outputPath)

      const headers = new Headers()
      const outputExtension = sourceFormat === 'pdf' ? 'pdf' : sourceFormat
      headers.set('Content-Type', sourceFormat === 'pdf'
        ? 'application/pdf'
        : sourceFormat === 'docm'
          ? 'application/vnd.ms-word.document.macroEnabled.12'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      const downloadName = buildDownloadName(contract.filename, outputExtension)
      headers.set(
        'Content-Disposition',
        `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`
      )

      logRouteDone(
        {
          route,
          requestId,
          userId: user.id,
          details: { contractId: id },
        },
        startedAt,
        {
          reviewId: latestReview?.id || null,
          sourceHash: actualSourceHash,
          anchoredComments: exportResult.anchored,
          trackedRevisions: 'revisions' in exportResult ? exportResult.revisions : 0,
          unlocatedComments: exportResult.unlocated?.length || 0,
        }
      )

      return new NextResponse(fileBuffer, { headers })
    } finally {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath)
      if (outputPath && fs.existsSync(outputPath)) fs.unlinkSync(outputPath)
    }
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    await logRouteFailure(
      req,
      {
        route,
        requestId,
        details: { contractId: routeId },
      },
      startedAt,
      error
    )
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
