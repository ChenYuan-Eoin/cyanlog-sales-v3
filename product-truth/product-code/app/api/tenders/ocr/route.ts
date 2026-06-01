// REQ:F008
// PURPOSE: OCR document parsing for tender/bidding documents

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// POST /api/tenders/ocr - 解析招标文件
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)

    // TODO: Implement actual OCR logic
    // For now, return placeholder response

    return NextResponse.json({
      success: true,
      message: 'OCR解析已接收，处理中...',
      status: 'processing',
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
