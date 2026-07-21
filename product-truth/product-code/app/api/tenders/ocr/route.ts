// REQ:F008
// PURPOSE: OCR document parsing for tender/bidding documents

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { isDocumentParsePlaceholder, parseDocument } from '@/lib/ocr/parser'
import { extractTenderInfo } from '@/lib/ocr/tender-parser'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { AIExecutionError } from '@/lib/ai/runtime-executor'
import { extractTenderWithAIPlan, TenderAIOutputError } from '@/lib/ai/tender-extract'

export const runtime = 'nodejs'

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

function executionEnvironment(): 'local' | 'hosted' {
  return process.env.VERCEL === '1' && Boolean(process.env.VERCEL_URL || process.env.VERCEL_REGION)
    ? 'hosted'
    : 'local'
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

    // Deterministic parsing remains a non-model baseline only. It cannot
    // fabricate model_invocations or replace the published AI route.
    const deterministicKeyInfo = extractTenderInfo(text)
    const orgId = await getDefaultOrgId(user.id)
    let keyInfo: Awaited<ReturnType<typeof extractTenderWithAIPlan>>['keyInfo']
    try {
      const aiResult = await extractTenderWithAIPlan({
        orgId,
        text,
        base: deterministicKeyInfo,
        executionEnvironment: executionEnvironment(),
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        sizeBytes: file.size,
      })
      keyInfo = aiResult.keyInfo
    } catch (error) {
      console.error('Tender AI runtime error:', error)
      if (error instanceof AIExecutionError) {
        return errorResponse(
          error.failureAction === 'manual_review'
            ? '可用模型均失败，标书需要人工处理。'
            : '可用模型均失败，标书解析已停止。',
          503,
          error.failureAction === 'manual_review'
            ? 'TENDER_AI_MANUAL_REVIEW_REQUIRED'
            : 'TENDER_AI_RUNTIME_STOPPED',
        )
      }
      if (error instanceof TenderAIOutputError) {
        return errorResponse(
          error.message,
          error.code === 'DOCUMENT_TOO_LARGE' ? 422 : 503,
          error.code === 'DOCUMENT_TOO_LARGE'
            ? 'TENDER_DOCUMENT_TOO_LARGE'
            : 'TENDER_AI_OUTPUT_INVALID',
        )
      }
      return errorResponse('AI 运行配置不可用，请联系管理员', 503, 'TENDER_AI_RUNTIME_UNAVAILABLE')
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
