import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

export const runtime = 'nodejs'
export const preferredRegion = 'sin1'

const querySchema = z.object({
  from: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)

    const { searchParams } = new URL(req.url)
    const result = querySchema.safeParse({
      from: searchParams.get('from') || undefined,
      limit: searchParams.get('limit') || 50,
    })
    if (!result.success) return errorResponse('查询参数无效', 400, 'INVALID_QUERY')

    const from = result.data.from || new Date().toISOString()
    const { data, error } = await supabaseAdmin
      .from('agenda_items')
      .select('*')
      .gte('start_at', from)
      .or(`user_id.eq.${user.id},assignee_id.eq.${user.id},created_by.eq.${user.id}`)
      .order('start_at', { ascending: true })
      .limit(result.data.limit)

    if (error) return errorResponse('查询失败', 500, 'DB_ERROR')

    return NextResponse.json({ data: data || [] })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
