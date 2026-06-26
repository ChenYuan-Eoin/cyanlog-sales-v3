import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'sin1'

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET(req: NextRequest) {
  try {
    await requireAuth(req)

    const { data, error } = await supabaseAdmin
      .from('ocr_results')
      .select('id, original_file, key_info, confidence, status, created_at')
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) {
      console.error('Get tenders error:', error)
      return errorResponse('获取标书列表失败', 500, 'DB_ERROR')
    }

    return NextResponse.json(
      { success: true, data: data || [] },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Get tenders error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
