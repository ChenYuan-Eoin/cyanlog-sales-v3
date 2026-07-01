// REQ:F007
// PURPOSE: Export contract review results as Word document with comments

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { generateWordDocument } from '@/lib/export/word-generator'
import fs from 'fs'
import { getRequestId, logRouteDone, logRouteFailure, logRouteStart } from '@/lib/observability'
import { logError } from '@/lib/error-log'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'
import {
  buildCommentPatchesFromRiskCards,
  extractRiskFindingId,
} from '@/lib/contracts/comment-patch'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

function buildContentDisposition(filename: string) {
  const asciiFallback = filename
    .replace(/[^\x20-\x7E]/g, '-')
    .replace(/[\\"]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 140) || 'contract-review.docx'
  const encodedFilename = encodeURIComponent(filename)

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodedFilename}`
}

function formatDuration(durationMs: number) {
  return Math.max(0, durationMs).toFixed(1)
}

function createExportTiming() {
  const metrics: Array<{ name: string; durationMs: number }> = []

  return {
    async measure<T>(name: string, task: () => PromiseLike<T> | T): Promise<T> {
      const start = performance.now()
      try {
        return await task()
      } finally {
        metrics.push({ name, durationMs: performance.now() - start })
      }
    },
    measureSync<T>(name: string, task: () => T): T {
      const start = performance.now()
      try {
        return task()
      } finally {
        metrics.push({ name, durationMs: performance.now() - start })
      }
    },
    headerValue() {
      return metrics
        .map((metric) => `${metric.name};dur=${formatDuration(metric.durationMs)}`)
        .join(', ')
    },
    toJSON() {
      return Object.fromEntries(
        metrics.map((metric) => [metric.name, Number(formatDuration(metric.durationMs))])
      )
    },
    attach(headers: Headers) {
      const value = this.headerValue()
      headers.set('Server-Timing', value)
      headers.set('X-Export-Timing', value)
    },
  }
}

// POST /api/contracts/:id/export - 导出带批注的Word文档
export async function POST(
  req: NextRequest,
  { params }: AsyncRouteParams
) {
  const startedAt = Date.now()
  const exportTiming = createExportTiming()
  const requestId = getRequestId(req)
  const route = '/api/contracts/[id]/export'
  let routeId = ''

  try {
    const user = await requireAuth(req)
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
    const { data: contract, error: contractError } = await exportTiming.measure('review_data_load', () => (
      supabaseAdmin
        .from('contracts')
        .select('*, contract_reviews(*)')
        .eq('id', id)
        .eq('org_id', orgId)
        .in('created_by', accessibleUserIds)
        .maybeSingle()
    ))

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

    // 检查是否有审核结果
    const latestReview = contract.contract_reviews?.[0]
    if (!latestReview || !latestReview.results) {
      return errorResponse('合同尚未完成审核', 400, 'NO_REVIEW_RESULTS')
    }

    // 获取审核结果中的风险项
    const reviewResults = latestReview.results as {
      summary?: string
      risks?: Array<{
        level: 'red' | 'yellow' | 'green'
        title: string
        description: string
        suggestion: string
      }>
    }

    // 获取结构化报告字段
    const riskSummary = (latestReview as unknown as { risk_summary?: {
      total_clauses: number
      critical_risks: number
      high_risks: number
      medium_risks: number
      low_risks: number
      compliance_score: number
      strategy_code?: string
    } }).risk_summary

    const complianceCheck = (latestReview as unknown as { compliance_check?: {
      missing_required_clauses: string[]
      dangerous_clauses: string[]
      ambiguous_clauses: string[]
      unbalanced_clauses: string[]
      party_a_consistency: string
      party_b_consistency: string
      issues: string[]
    } }).compliance_check

    const effectivenessAnalysis = (latestReview as unknown as { effectiveness_analysis?: string }).effectiveness_analysis

    // 加载合同条款（按 position 排序）
    const { data: clauses, error: clausesError } = await exportTiming.measure('clauses_load', () => (
      supabaseAdmin
        .from('contract_clauses')
        .select('id, clause_number, clause_title, clause_text, risk_level, risk_category, risk_description, legal_basis, suggestion, position')
        .eq('review_id', latestReview.id)
        .order('position', { ascending: true })
    ))

    if (clausesError) {
      return errorResponse('加载合同条款失败', 500, 'CLAUSES_QUERY_FAILED')
    }

    // 加载批注
    const { data: annotations, error: annotationsError } = await exportTiming.measure('annotations_load', () => (
      supabaseAdmin
        .from('contract_annotations')
        .select('id, start_offset, end_offset, selected_text, comment, category, priority, status, author_id, created_at')
        .eq('contract_id', id)
        .order('created_at', { ascending: true })
    ))

    if (annotationsError) {
      return errorResponse('加载合同批注失败', 500, 'ANNOTATIONS_QUERY_FAILED')
    }

    const { data: riskCardsForPatches, error: riskCardsError } = await exportTiming.measure('risk_patches_load', () => (
      supabaseAdmin
        .from('contract_risk_cards')
        .select('id, level, title, description, suggestion, evidence, status, position_start, position_end')
        .eq('contract_id', id)
        .eq('review_id', latestReview.id)
        .order('created_at', { ascending: true })
    ))

    if (riskCardsError) {
      return errorResponse('加载风险批注意图失败', 500, 'RISK_PATCH_QUERY_FAILED')
    }

    let exportAnnotations = annotations || []
    const existingRiskIds = new Set(
      exportAnnotations
        .map((annotation) => extractRiskFindingId(annotation.comment))
        .filter((riskId): riskId is string => Boolean(riskId))
    )
    const missingCommentPatches = buildCommentPatchesFromRiskCards({
      contractId: id,
      risks: riskCardsForPatches || [],
      existingRiskIds,
    })

    if (missingCommentPatches.length > 0) {
      const { data: insertedAnnotations, error: patchInsertError } = await exportTiming.measure('comment_patch_insert', () => (
        supabaseAdmin
          .from('contract_annotations')
          .insert(missingCommentPatches.map((patch) => ({
            ...patch.annotation,
            author_id: user.id,
          })))
          .select('id, start_offset, end_offset, selected_text, comment, category, priority, status, author_id, created_at')
      ))

      if (patchInsertError) {
        return errorResponse('生成风险批注意图失败', 500, 'COMMENT_PATCH_INSERT_FAILED')
      }

      exportAnnotations = [
        ...exportAnnotations,
        ...(insertedAnnotations || []),
      ]
    }

    // 加载策略名称
    let strategyName = ''
    if (riskSummary?.strategy_code) {
      const { data: strategy } = await supabaseAdmin
        .from('review_strategies')
        .select('name')
        .eq('code', riskSummary.strategy_code)
        .or('org_id.is.null,org_id.eq.' + orgId)
        .limit(1)
        .maybeSingle()
      strategyName = strategy?.name || riskSummary.strategy_code
    }

    const exportData = {
      summary: reviewResults.summary,
      risks: reviewResults.risks || [],
      risk_summary: riskSummary,
      compliance_check: complianceCheck,
      effectiveness_analysis: effectivenessAnalysis,
      clauses: clauses || [],
      annotations: exportAnnotations,
      strategy_name: strategyName,
      strategy_code: riskSummary?.strategy_code,
    }

    const { data: versions, error: versionError } = await exportTiming.measure('versions_load', () => (
      supabaseAdmin
        .from('contract_versions')
        .select('id, version_number, source')
        .eq('contract_id', id)
        .order('version_number', { ascending: false })
    ))

    if (versionError) {
      return errorResponse('获取合同版本失败', 500, 'VERSION_QUERY_FAILED')
    }

    const latestVersion = versions?.[0] || null
    const sourceVersion = versions?.find((version) => version.source !== 'review_revision') || latestVersion
    const nextVersionNumber = (latestVersion?.version_number || 0) + 1

    // 下载原始合同文件
    const { data: fileData, error: fileError } = await exportTiming.measure('storage_download', () => (
      supabaseAdmin.storage
        .from('contracts')
        .download(contract.storage_path)
    ))

    if (fileError) {
      await logError({
        req,
        source: 'api',
        userId: user.id,
        message: fileError.message,
        error: fileError,
        context: {
          route,
          requestId,
          contractId: id,
          phase: 'download_source_contract',
        },
      })
    }

    // Save to temp file if download succeeded
    let inputPath = ''
    if (fileData) {
      inputPath = await exportTiming.measure('source_temp_write', async () => {
        const tempInputPath = `/tmp/contract-${id}-input.docx`
        const buffer = Buffer.from(await fileData.arrayBuffer())
        fs.writeFileSync(tempInputPath, buffer)
        return tempInputPath
      })
    }

    // Generate a source-docx-derived Word document with native comments.
    const exportResult = await exportTiming.measure('docx_generate', () => generateWordDocument(inputPath, exportData))

    // Clean up temp input file
    if (inputPath && fs.existsSync(inputPath)) {
      fs.unlinkSync(inputPath)
    }

    if (!exportResult.success || !exportResult.outputPath) {
      return errorResponse(
        exportResult.error || '文档生成失败',
        500,
        'EXPORT_FAILED'
      )
    }
    if (exportResult.mode !== 'source_comments') {
      return errorResponse(
        '未生成源文件批注版，请检查源文件格式',
        500,
        'EXPORT_NOT_SOURCE_COMMENTS'
      )
    }
    const outputPath = exportResult.outputPath

    // Read the generated file
    const fileBuffer = exportTiming.measureSync('output_file_read', () => fs.readFileSync(outputPath))
    const outputStoragePath = `reviewed/${id}/v${nextVersionNumber}-${Date.now()}-ones-review.docx`
    const { error: uploadError } = await exportTiming.measure('storage_upload', () => (
      supabaseAdmin.storage
        .from('contracts')
        .upload(outputStoragePath, fileBuffer, {
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          upsert: false,
        })
    ))

    if (uploadError) {
      fs.unlinkSync(outputPath)
      return errorResponse('批注版文件写入失败', 500, 'EXPORT_UPLOAD_FAILED')
    }

    const { error: insertVersionError } = await exportTiming.measure('version_register', () => (
      supabaseAdmin
        .from('contract_versions')
        .insert({
          contract_id: id,
          version_number: nextVersionNumber,
          source: 'review_revision',
          storage_path: outputStoragePath,
          file_size: fileBuffer.length,
          mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          parent_version_id: sourceVersion?.id || null,
          change_summary: 'ONES 业务运营基于风险项生成 Word 批注版本',
          uploaded_by: user.id,
          review_id: latestReview.id,
        })
    ))

    if (insertVersionError) {
      fs.unlinkSync(outputPath)
      await supabaseAdmin.storage.from('contracts').remove([outputStoragePath])
      return errorResponse('批注版版本登记失败', 500, 'EXPORT_VERSION_FAILED')
    }

    const { error: reportLinkError } = await exportTiming.measure('report_version_link', () => (
      supabaseAdmin
        .from('report_versions')
        .update({ report_file_url: outputStoragePath })
        .eq('contract_id', id)
        .eq('is_current', true)
    ))

    if (reportLinkError) {
      fs.unlinkSync(outputPath)
      await supabaseAdmin.storage.from('contracts').remove([outputStoragePath])
      await supabaseAdmin
        .from('contract_versions')
        .delete()
        .eq('contract_id', id)
        .eq('version_number', nextVersionNumber)
        .eq('source', 'review_revision')
      return errorResponse('报告版本关联批注文件失败', 500, 'EXPORT_REPORT_LINK_FAILED')
    }

    // Clean up temp output file
    fs.unlinkSync(outputPath)

    // Return file as download
    const headers = new Headers()
    const sourceFilename = String(contract.filename || 'contract').replace(/\.[^.]+$/, '')
    headers.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    headers.set(
      'Content-Disposition',
      buildContentDisposition(`${sourceFilename}-审核结果.docx`)
    )
    exportTiming.attach(headers)

    logRouteDone(
      {
        route,
        requestId,
        userId: user.id,
        details: { contractId: id },
      },
      startedAt,
      {
        reviewId: latestReview.id,
        versionNumber: nextVersionNumber,
        exportTiming: exportTiming.toJSON(),
      }
    )

    return new NextResponse(fileBuffer, { headers })
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
