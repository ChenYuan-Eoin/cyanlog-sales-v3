import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'

export const runtime = 'nodejs'
export const preferredRegion = 'sin1'

const querySchema = z.object({
  from: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)

    const { searchParams } = new URL(req.url)
    const result = querySchema.safeParse({
      from: searchParams.get('from') || undefined,
      limit: searchParams.get('limit') || 50,
    })
    if (!result.success) return errorResponse(createApiError('VALIDATION_ERROR', '查询参数无效'))

    const from = result.data.from || new Date().toISOString()
    const { data, error } = await supabaseAdmin
      .from('agenda_items')
      .select('*')
      .gte('start_at', from)
      .or(`user_id.eq.${user.id},assignee_id.eq.${user.id},created_by.eq.${user.id}`)
      .order('start_at', { ascending: true })
      .limit(result.data.limit)

    if (error) return errorResponse(createApiError('DB_ERROR', '查询失败'))

    return successResponse(data || [])
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse(createApiError('UNAUTHORIZED'))
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}
