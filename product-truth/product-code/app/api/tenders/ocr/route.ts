// REQ:F008
// PURPOSE: OCR document parsing for tender/bidding documents

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { extractKeyInfo, parseDocument } from '@/lib/ocr/parser'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// POST /api/tenders/ocr - 解析招标文件
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)

    // Get form data with file
    const formData = await req.formData()
    const file = formData.get('file') as File

    if (!file) {
      return errorResponse('请选择要解析的文件', 400, 'MISSING_FILE')
    }

    // Read file content
    const buffer = Buffer.from(await file.arrayBuffer())
    const text = await parseDocument(buffer, file.type)

    // Extract key information
    const keyInfo = extractKeyInfo(text)

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
