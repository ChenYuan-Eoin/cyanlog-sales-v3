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
  appendRiskControlCommentLines,
  buildCommentPatchesFromRiskCards,
  buildCustomerFacingWordComment,
  extractRiskFindingId,
  type RiskCardCommentSource,
} from '@/lib/contracts/comment-patch'
import { hasUsableWordCommentAnchor } from '@/lib/contracts/word-comment-anchor'

type ExportReviewRow = {
  id: string
  model_invocation_ids?: string[] | null
  skill_bundle_id?: string | null
  model_policy_id?: string | null
}

type ExportAnnotationRow = {
  id?: string
  selected_text?: string | null
  comment?: string | null
}

type ExportModelInvocationRow = {
  id: string
  phase?: string | null
  provider?: string | null
  model?: string | null
  status?: string | null
  degraded?: boolean | null
  fallback_reason?: string | null
  error_message?: string | null
  response_meta?: unknown
}

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function buildSourceCommentExportGateIssues(annotations: ExportAnnotationRow[]) {
  const manualLocationCount = annotations.filter((annotation) => (
    !annotation.selected_text?.trim()
    || annotation.comment?.includes('LocationStatus: manual_required')
    || annotation.comment?.includes('【需人工定位】')
  )).length
  const unsafeAnchorCount = annotations.filter((annotation) => {
    const selectedText = annotation.selected_text?.trim() || ''
    if (!selectedText) return false
    return !hasUsableWordCommentAnchor(selectedText)
  }).length
  const issues: string[] = []

  if (manualLocationCount > 0) {
    issues.push(`${manualLocationCount} 条 Word 批注意图需要人工定位，导出前必须处理。`)
  }
  if (unsafeAnchorCount > 0) {
    issues.push(`${unsafeAnchorCount} 条 Word 批注意图疑似跨段或证据过短，不能稳定写入源文件批注。`)
  }

  return issues
}

function buildReviewModelExportGateIssues(invocations: ExportModelInvocationRow[]) {
  const semanticInvocation = invocations.find((invocation) => invocation.phase === 'semantic_review')
  if (!semanticInvocation) {
    return ['缺少 semantic_review 模型调用证据，不能生成正式源文件批注版。']
  }

  const responseMeta = asRecord(semanticInvocation.response_meta)
  const providerKind = typeof responseMeta?.provider_kind === 'string' ? responseMeta.provider_kind : null
  const transport = typeof responseMeta?.transport === 'string' ? responseMeta.transport : null
  const warningCount = Array.isArray(responseMeta?.validation_warnings)
    ? responseMeta.validation_warnings.length
    : 0
  const droppedRiskCount = numberValue(responseMeta?.dropped_risk_count) ?? 0
  const issues: string[] = []

  if (semanticInvocation.status !== 'completed') {
    issues.push(`semantic_review 状态为 ${semanticInvocation.status || 'missing'}，不能视为 AI 审核完成。`)
  }
  if (semanticInvocation.degraded) {
    issues.push(`semantic_review 已降级：${semanticInvocation.fallback_reason || semanticInvocation.error_message || '未记录原因'}。`)
  }
  if (providerKind !== 'openai_compatible' || transport !== 'openai_compatible_http') {
    issues.push(`semantic_review 未通过 OpenAI-compatible HTTP 模型链路：${providerKind || semanticInvocation.provider || 'unknown'} / ${transport || 'unknown'}。`)
  }
  if (warningCount > 0 || droppedRiskCount > 0) {
    issues.push(`semantic_review 存在 ${warningCount} 条校验警告和 ${droppedRiskCount} 个被剔除风险，不能生成正式源文件批注版。`)
  }

  return issues
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

function safeStorageSegment(value: string | null | undefined) {
  return String(value || 'unknown')
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'unknown'
}

function buildDownloadHeaders(input: {
  filename: string
  versionNumber?: number | null
  reusedOutput: boolean
  outputStoragePath?: string | null
}) {
  const headers = new Headers()
  headers.set('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  headers.set('Content-Disposition', buildContentDisposition(input.filename))
  headers.set('X-Export-Reused', input.reusedOutput ? 'true' : 'false')
  if (typeof input.versionNumber === 'number') {
    headers.set('X-Contract-Version-Number', String(input.versionNumber))
  }
  if (input.outputStoragePath) {
    headers.set('X-Contract-Output-Path', input.outputStoragePath)
  }
  return headers
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

function buildDeterministicExportAudit(input: {
  review: ExportReviewRow
  annotationCount: number
  generatedPatchCount: number
  riskCount: number
  outputStoragePath: string
  sourceVersionId?: string | null
  outputVersionNumber: number
  exportTiming: Record<string, number>
  modelGateIssues: string[]
}) {
  return {
    // model_invocations is reserved for real model requests. Patching a source
    // document and reusing an existing summary are deterministic export steps;
    // their durable evidence is the registered contract version and identities.
    modelInvocationIds: Array.from(new Set(
      Array.isArray(input.review.model_invocation_ids) ? input.review.model_invocation_ids : []
    )),
    deterministicSteps: {
      source: 'contract_risk_cards_annotations_and_existing_review_summary',
      annotation_count: input.annotationCount,
      generated_patch_count: input.generatedPatchCount,
      risk_count: input.riskCount,
      output_storage_path: input.outputStoragePath,
      source_version_id: input.sourceVersionId || null,
      output_version_number: input.outputVersionNumber,
      export_timing: input.exportTiming,
      model_gate_warnings: input.modelGateIssues,
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

    // Only the current source version may be exported. A newer historical
    // ReviewRun must never be mistaken for the current file's result.
    const currentVersionId = typeof contract.current_version_id === 'string'
      ? contract.current_version_id
      : null
    const latestReview = currentVersionId
      ? contract.contract_reviews?.find((review: { contract_version_id?: string | null }) => (
          review.contract_version_id === currentVersionId
        ))
      : null
    if (!latestReview || !latestReview.results) {
      return errorResponse('当前文件版本尚未完成审核', 400, 'NO_CURRENT_REVIEW_RESULTS')
    }

    const { data: sourceVersion, error: sourceVersionError } = await exportTiming.measure('source_version_load', () => (
      supabaseAdmin
        .from('contract_versions')
        .select('id, contract_id, version_number, source, storage_path, file_size, mime_type, parent_version_id, review_id, change_summary, upload_id, file_sha256, text_sha256, parsed_text, ingest_status, created_at')
        .eq('id', currentVersionId)
        .eq('contract_id', id)
        .maybeSingle()
    ))
    const sourceIdentityMatches = Boolean(
      sourceVersion
      && sourceVersion.source !== 'review_revision'
      && sourceVersion.ingest_status === 'SOURCE_READY'
      && sourceVersion.storage_path
      && sourceVersion.storage_path === contract.storage_path
      && sourceVersion.storage_path === latestReview.source_storage_path
      && sourceVersion.file_sha256 === latestReview.source_hash
      && sourceVersion.text_sha256 === latestReview.source_text_hash
      && sourceVersion.parsed_text === contract.parsed_text
    )
    if (sourceVersionError || !sourceVersion || !sourceIdentityMatches) {
      return errorResponse(
        '当前审核与源文件版本不一致，请重新准备文件或发起审核后再导出',
        409,
        'CURRENT_SOURCE_IDENTITY_INVALID',
      )
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
        .eq('review_id', latestReview.id)
        .eq('contract_version_id', currentVersionId)
        .eq('binding_state', 'bound')
        .order('created_at', { ascending: true })
    ))

    if (annotationsError) {
      return errorResponse('加载合同批注失败', 500, 'ANNOTATIONS_QUERY_FAILED')
    }

    const { data: riskCardsForPatches, error: riskCardsError } = await exportTiming.measure('risk_patches_load', () => (
      supabaseAdmin
        .from('contract_risk_cards')
        .select('id, rule_id, rule_code, rule_version, level, title, description, suggestion, evidence, fix_action, status, position_start, position_end')
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
      sourceText: typeof contract.parsed_text === 'string' ? contract.parsed_text : undefined,
    })

    if (missingCommentPatches.length > 0) {
      const { data: insertedAnnotations, error: patchInsertError } = await exportTiming.measure('comment_patch_insert', () => (
        supabaseAdmin
          .from('contract_annotations')
          .insert(missingCommentPatches.map((patch) => ({
            ...patch.annotation,
            review_id: latestReview.id,
            contract_version_id: currentVersionId,
            binding_state: 'bound',
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

    const riskById = new Map(
      ((riskCardsForPatches || []) as RiskCardCommentSource[]).map((risk) => [risk.id, risk] as const)
    )
    const annotationControlUpdates = exportAnnotations
      .map((annotation) => {
        const riskId = extractRiskFindingId(annotation.comment)
        const risk = riskId ? riskById.get(riskId) : null
        if (!annotation.id || !risk) return null
        const nextComment = appendRiskControlCommentLines(annotation.comment || '', risk)
        return nextComment !== annotation.comment
          ? { id: annotation.id, comment: nextComment }
          : null
      })
      .filter((item): item is { id: string; comment: string } => Boolean(item))

    if (annotationControlUpdates.length > 0) {
      const updateResults = await exportTiming.measure('control_comment_update', async () => (
        Promise.all(annotationControlUpdates.map((item) => (
          supabaseAdmin
            .from('contract_annotations')
            .update({ comment: item.comment })
            .eq('id', item.id)
        )))
      ))
      const updateError = updateResults.find((result) => result.error)?.error
      if (updateError) {
        return errorResponse('同步风险可控说明到批注意图失败', 500, 'CONTROL_COMMENT_UPDATE_FAILED')
      }

      const updateById = new Map(annotationControlUpdates.map((item) => [item.id, item.comment] as const))
      exportAnnotations = exportAnnotations.map((annotation) => (
        annotation.id && updateById.has(annotation.id)
          ? { ...annotation, comment: updateById.get(annotation.id) || annotation.comment }
          : annotation
      ))
    }

    const exportGateIssues = buildSourceCommentExportGateIssues(exportAnnotations)
    if (exportGateIssues.length > 0) {
      return errorResponse(
        exportGateIssues.join('；'),
        400,
        'EXPORT_GATE_BLOCKED'
      )
    }

    const rawModelInvocationIds: unknown[] = Array.isArray(latestReview.model_invocation_ids)
      ? latestReview.model_invocation_ids
      : []
    const modelInvocationIds = rawModelInvocationIds.filter((item): item is string => (
      typeof item === 'string' && item.length > 0
    ))
    let modelGateIssues = modelInvocationIds.length === 0
      ? ['ReviewRun 缺少模型调用证据，本次只导出已定位批注意图，不能视为正式 AI 审核完成。']
      : []
    if (modelInvocationIds.length > 0) {
      const { data: modelInvocations, error: modelInvocationsError } = await exportTiming.measure('model_invocations_load', () => (
        supabaseAdmin
          .from('model_invocations')
          .select('id, phase, provider, model, status, degraded, fallback_reason, error_message, response_meta')
          .in('id', modelInvocationIds)
      ))

      if (modelInvocationsError) {
        return errorResponse('加载模型调用证据失败', 500, 'MODEL_INVOCATIONS_QUERY_FAILED')
      }

      modelGateIssues = buildReviewModelExportGateIssues(modelInvocations || [])
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
      annotations: exportAnnotations.map((annotation) => ({
        ...annotation,
        comment: buildCustomerFacingWordComment(annotation.comment) || annotation.comment || '',
        selected_text: annotation.selected_text || '',
        priority: annotation.priority || 'high',
        status: annotation.status || 'open',
      })),
      strategy_name: strategyName,
      strategy_code: riskSummary?.strategy_code,
    }

    const { data: versions, error: versionError } = await exportTiming.measure('versions_load', () => (
      supabaseAdmin
        .from('contract_versions')
        .select('id, version_number, source, storage_path, parent_version_id, review_id, change_summary, created_at')
        .eq('contract_id', id)
        .order('version_number', { ascending: false })
    ))

    if (versionError) {
      return errorResponse('获取合同版本失败', 500, 'VERSION_QUERY_FAILED')
    }

    const latestVersion = versions?.[0] || null
    const nextVersionNumber = (latestVersion?.version_number || 0) + 1
    const sourceStoragePath = sourceVersion.storage_path
    const existingOutput = missingCommentPatches.length === 0 && annotationControlUpdates.length === 0
      ? versions?.find((version) => (
        version.source === 'review_revision'
        && version.review_id === latestReview.id
        && version.parent_version_id === sourceVersion.id
        && version.storage_path
        && String(version.change_summary || '').includes('customer-comment-v4')
      ))
      : null

    if (existingOutput?.storage_path) {
      const { data: existingFile, error: existingFileError } = await exportTiming.measure('existing_output_download', () => (
        supabaseAdmin.storage
          .from('contracts')
          .download(existingOutput.storage_path)
      ))

      if (!existingFileError && existingFile) {
        const existingBuffer = Buffer.from(await existingFile.arrayBuffer())
        const sourceFilename = String(contract.filename || 'contract').replace(/\.[^.]+$/, '')
        const headers = buildDownloadHeaders({
          filename: `${sourceFilename}-审核结果.docx`,
          versionNumber: existingOutput.version_number,
          reusedOutput: true,
          outputStoragePath: existingOutput.storage_path,
        })
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
            versionNumber: existingOutput.version_number,
            reusedOutput: true,
            exportTiming: exportTiming.toJSON(),
          }
        )

        return new NextResponse(existingBuffer, { headers })
      }
    }

    // 下载原始合同文件
    const { data: fileData, error: fileError } = await exportTiming.measure('storage_download', () => (
      supabaseAdmin.storage
        .from('contracts')
        .download(sourceStoragePath)
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
          sourceVersionId: sourceVersion?.id || null,
          sourceStoragePath,
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
    const outputStoragePath = [
      'reviewed',
      safeStorageSegment(id),
      `review-${safeStorageSegment(latestReview.id)}`,
      `source-${safeStorageSegment(sourceVersion.id)}-${Date.now()}.docx`,
    ].join('/')
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
          parent_version_id: sourceVersion.id,
          change_summary: `customer-comment-v4：ONES 业务运营基于风险项生成客户侧 Word 原生批注版本（ReviewRun: ${latestReview.id}）`,
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
        .eq('review_id', latestReview.id)
        .eq('contract_version_id', currentVersionId)
        .eq('binding_state', 'bound')
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

    const exportAuditEvidence = buildDeterministicExportAudit({
      review: latestReview,
      annotationCount: exportAnnotations.length,
      generatedPatchCount: missingCommentPatches.length,
      riskCount: reviewResults.risks?.length || 0,
      outputStoragePath,
      sourceVersionId: sourceVersion.id,
      outputVersionNumber: nextVersionNumber,
      exportTiming: exportTiming.toJSON(),
      modelGateIssues,
    })

    // Clean up temp output file
    fs.unlinkSync(outputPath)

    // Return file as download
    const sourceFilename = String(contract.filename || 'contract').replace(/\.[^.]+$/, '')
    const headers = buildDownloadHeaders({
      filename: `${sourceFilename}-审核结果.docx`,
      versionNumber: nextVersionNumber,
      reusedOutput: false,
      outputStoragePath,
    })
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
            modelInvocationIds: exportAuditEvidence.modelInvocationIds,
            deterministicExport: exportAuditEvidence.deterministicSteps,
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
