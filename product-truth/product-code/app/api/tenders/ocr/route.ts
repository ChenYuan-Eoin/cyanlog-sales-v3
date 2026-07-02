// REQ:F008
// PURPOSE: OCR document parsing for tender/bidding documents

import { NextRequest, NextResponse } from 'next/server'
import { performance } from 'node:perf_hooks'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { isDocumentParsePlaceholder, parseDocument } from '@/lib/ocr/parser'
import { extractTenderInfo } from '@/lib/ocr/tender-parser'
import { analyzeTenderWithCloudModel, type TenderAIAnalysisResult } from '@/lib/ocr/tender-ai'
import { getDefaultOrgId } from '@/lib/scoped-access'
import {
  recordModelInvocation,
  resolvePublishedModelPolicy,
  selectReviewExecutionProvider,
  type ContractModelPolicy,
  type ModelPolicyProvider,
} from '@/lib/contracts/model-policy'

function isFile(value: unknown): value is File {
  return typeof File !== 'undefined' && value instanceof File
}

const ocrFormSchema = z.object({
  file: z.custom<File>(isFile),
})

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({
    success: false,
    error: {
      code: code || 'OCR_ERROR',
      message,
    },
  }, { status })
}

function cloudTenderProvider(policy: ContractModelPolicy | null): ModelPolicyProvider | null {
  const supportsTenderLongDocument = (provider: ModelPolicyProvider | undefined | null): provider is ModelPolicyProvider => (
    provider !== null
    && provider !== undefined
    && provider.provider_kind === 'openai_compatible'
    && provider.runtime_location === 'cloud'
    && provider.stages.includes('tender_long_document_parse')
  )

  if (policy) {
    const stageProvider = selectReviewExecutionProvider(policy, 'tender_long_document_parse')
    if (supportsTenderLongDocument(stageProvider)) {
      return stageProvider
    }
  }

  return policy?.provider_chain.find((provider) => (
    provider.profile === 'sales_cloud_backup' && supportsTenderLongDocument(provider)
  ))
    || policy?.provider_chain.find((provider) => (
      provider.level === 2 && supportsTenderLongDocument(provider)
    ))
    || policy?.provider_chain.find((provider) => supportsTenderLongDocument(provider))
    || null
}

function tenderChunkLimit(policy: ContractModelPolicy | null) {
  const provider = cloudTenderProvider(policy)
  const configured = provider?.routing?.max_pages
  if (typeof configured !== 'number' || !Number.isFinite(configured)) return 30
  return Math.max(10, Math.min(80, Math.round(configured)))
}

function countList(value: unknown) {
  return Array.isArray(value) ? value.length : 0
}

function assertTenderCloudQuality(aiResult: TenderAIAnalysisResult | null): asserts aiResult is TenderAIAnalysisResult {
  if (!aiResult?.keyInfo) {
    throw new Error('云端标书模型未返回可用解析结果')
  }

  const runtime = aiResult.runtime
  if (runtime.transport === 'manual_fallback' || runtime.provider === 'manual-fallback') {
    throw new Error('云端标书模型未实际运行')
  }
  if (runtime.analyzed_chunk_count <= 0) {
    throw new Error('云端标书模型未成功解析任何文档片段')
  }
  if (runtime.analyzed_chunk_count < runtime.selected_chunk_count) {
    const details = runtime.attempt_errors.slice(0, 4).join('；')
    throw new Error(
      `云端标书模型仅解析 ${runtime.analyzed_chunk_count}/${runtime.selected_chunk_count} 个已选片段${details ? `：${details}` : ''}`
    )
  }
  if (runtime.text_length >= 20_000 && runtime.character_coverage_ratio < 0.9) {
    throw new Error(`长文档云端解析覆盖率不足：${Math.round(runtime.character_coverage_ratio * 100)}%`)
  }
  if (typeof runtime.business_signal_count !== 'number' || runtime.business_signal_count <= 0) {
    throw new Error('云端标书模型未提取到业务字段')
  }
  if (runtime.text_length >= 20_000
    && (typeof runtime.business_signal_domains !== 'number' || runtime.business_signal_domains < 2)) {
    throw new Error(`长文档云端解析业务信号不足：${runtime.business_signal_domains}/2 个领域`)
  }
}

async function recordTenderInvocation(input: {
  orgId: string | null
  modelPolicy: ContractModelPolicy | null
  file: File
  textLength: number
  latencyMs: number
  aiResult: TenderAIAnalysisResult
}) {
  const runtime = input.aiResult.runtime
  const keyInfo = input.aiResult.keyInfo
  const provider = cloudTenderProvider(input.modelPolicy)
  return recordModelInvocation({
    orgId: input.orgId,
    modelPolicyId: input.modelPolicy?.id || null,
    provider: runtime.provider,
    model: runtime.model,
    phase: 'tender_long_document_parse',
    status: runtime.degraded ? 'degraded' : 'completed',
    degraded: runtime.degraded,
    fallbackReason: runtime.degraded ? 'tender_cloud_parse_partial' : null,
    latencyMs: input.latencyMs,
    requestMeta: {
      phase: 'tender_ocr',
      intended_provider_profile: provider?.profile || 'sales_cloud_backup',
      intended_provider_model: provider?.model || null,
      routing_strategy: provider?.routing?.strategy || 'chunked',
      configured_max_pages: provider?.routing?.max_pages || null,
      model_policy_id: input.modelPolicy?.id || null,
      model_policy_version: input.modelPolicy?.version || null,
      file_name: input.file.name,
      mime_type: input.file.type || 'application/octet-stream',
      size_bytes: input.file.size,
      extracted_text_length: input.textLength,
    },
    responseMeta: {
      provider_kind: 'openai_compatible',
      transport: runtime.transport,
      chunk_count: runtime.chunk_count,
      selected_chunk_count: runtime.selected_chunk_count,
      analyzed_chunk_count: runtime.analyzed_chunk_count,
      text_length: runtime.text_length,
      selected_text_length: runtime.selected_text_length,
      analyzed_text_length: runtime.analyzed_text_length,
      coverage_ratio: runtime.coverage_ratio,
      chunk_coverage_ratio: runtime.chunk_coverage_ratio,
      character_coverage_ratio: runtime.character_coverage_ratio,
      processing_ms: runtime.processing_ms,
      concurrency: runtime.concurrency,
      business_signal_count: runtime.business_signal_count,
      business_signal_domains: runtime.business_signal_domains,
      confidence: keyInfo.confidence,
      score_count: countList(keyInfo.scores),
      technical_requirement_count: countList(keyInfo.technicalRequirements),
      commercial_term_count: countList(keyInfo.commercialTerms),
      timeline_count: countList(keyInfo.timeline),
      attempt_errors: runtime.attempt_errors,
    },
    errorMessage: runtime.degraded && runtime.attempt_errors.length > 0
      ? runtime.attempt_errors.join('\n')
      : null,
  })
}

async function recordTenderFailure(input: {
  orgId: string | null
  modelPolicy: ContractModelPolicy | null
  file: File
  textLength: number
  latencyMs: number
  error: unknown
}) {
  const provider = cloudTenderProvider(input.modelPolicy)
  return recordModelInvocation({
    orgId: input.orgId,
    modelPolicyId: input.modelPolicy?.id || null,
    provider: provider?.provider || 'AI_LEVEL_2',
    model: provider?.model || 'unavailable',
    phase: 'tender_long_document_parse',
    status: 'failed',
    degraded: true,
    fallbackReason: 'tender_cloud_parse_failed',
    latencyMs: input.latencyMs,
    requestMeta: {
      phase: 'tender_ocr',
      intended_provider_profile: provider?.profile || 'sales_cloud_backup',
      intended_provider_model: provider?.model || null,
      routing_strategy: provider?.routing?.strategy || 'chunked',
      configured_max_pages: provider?.routing?.max_pages || null,
      model_policy_id: input.modelPolicy?.id || null,
      model_policy_version: input.modelPolicy?.version || null,
      file_name: input.file.name,
      mime_type: input.file.type || 'application/octet-stream',
      size_bytes: input.file.size,
      extracted_text_length: input.textLength,
    },
    responseMeta: {
      provider_kind: provider?.provider_kind || 'openai_compatible',
      transport: 'manual_fallback',
      attempt_errors: [input.error instanceof Error ? input.error.message : String(input.error)],
    },
    errorMessage: input.error instanceof Error ? input.error.message : String(input.error),
  })
}

// POST /api/tenders/ocr - 解析招标文件
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)

    // Get form data with file
    const formData = await req.formData().catch(() => null)
    if (!formData) {
      return errorResponse('表单数据无效', 400, 'INVALID_FORM')
    }

    const parsed = ocrFormSchema.safeParse({
      file: formData.get('file'),
    })
    if (!parsed.success) {
      return errorResponse('请选择要解析的文件', 400, 'MISSING_FILE')
    }

    const { file } = parsed.data

    // Read file content
    const buffer = Buffer.from(await file.arrayBuffer())
    const text = await parseDocument(buffer, file.type, file.name)
    if (isDocumentParsePlaceholder(text)) {
      const code = text.includes('视觉 OCR') ? 'VISUAL_OCR_REQUIRED' : 'UNSUPPORTED_DOCUMENT_TYPE'
      return errorResponse(`未提取到可审核正文：${text}`, 422, code)
    }

    // Extract key information with deterministic parser first, then enhance
    // long tender documents through the configured cloud model provider.
    const deterministicKeyInfo = extractTenderInfo(text)
    let keyInfo = deterministicKeyInfo
    let orgId: string | null = null
    let modelPolicy: ContractModelPolicy | null = null
    const aiStartedAt = performance.now()
    try {
      orgId = await getDefaultOrgId(user.id)
      modelPolicy = await resolvePublishedModelPolicy(orgId, user.id).catch(() => null)
      const provider = cloudTenderProvider(modelPolicy)
      if (!provider) {
        throw new Error('模型策略未发布支持 tender_long_document_parse 的云端 OpenAI-compatible Provider')
      }
      const aiResult = await analyzeTenderWithCloudModel(text, deterministicKeyInfo, {
        orgId,
        preferredProvider: provider.profile,
        maxChunks: tenderChunkLimit(modelPolicy),
      })
      assertTenderCloudQuality(aiResult)
      const aiLatencyMs = performance.now() - aiStartedAt
      const invocation = await recordTenderInvocation({
        orgId,
        modelPolicy,
        file,
        textLength: text.length,
        latencyMs: aiLatencyMs,
        aiResult,
      }).catch((invocationError) => {
        console.error('Record tender model invocation error:', invocationError)
        return null
      })
      keyInfo = {
        ...aiResult.keyInfo,
        aiRuntime: invocation
          ? { ...aiResult.runtime, model_invocation_id: invocation.id }
          : aiResult.runtime,
      }
    } catch (aiError) {
      await recordTenderFailure({
        orgId,
        modelPolicy,
        file,
        textLength: text.length,
        latencyMs: performance.now() - aiStartedAt,
        error: aiError,
      }).catch((invocationError) => {
        console.error('Record tender model failure error:', invocationError)
      })
      return errorResponse(
        `云端标书模型不可用，未生成可验收解析结果：${aiError instanceof Error ? aiError.message : String(aiError)}`,
        503,
        'TENDER_CLOUD_MODEL_UNAVAILABLE'
      )
    }

    // Save OCR result to database
    const { data: ocrResult, error } = await supabaseAdmin
      .from('ocr_results')
      .insert({
        original_file: file.name,
        extracted_text: text,
        key_info: keyInfo,
        confidence: keyInfo.confidence,
        status: 'completed',
        created_by: user.id,
      })
      .select()
      .single()

    if (error) {
      console.error('Save OCR result error:', error)
      return errorResponse('保存解析结果失败', 500, 'DB_ERROR')
    }

    return NextResponse.json({
      success: true,
      data: {
        id: ocrResult.id,
        fileName: file.name,
        keyInfo,
        text: text.substring(0, 500), // First 500 chars
        confidence: keyInfo.confidence,
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('OCR error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
