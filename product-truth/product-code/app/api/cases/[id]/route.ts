// /api/cases/[id] - 单案例查看/更新/删除

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { OUTCOMES } from '@/lib/case-library/types'
import { resolveIdParam, type AsyncRouteParams } from '@/lib/route-params'

export const runtime = 'nodejs'

const caseUpdateSchema = z.object({
  title: z.string().min(2).max(200).optional(),
  outcome: z.enum(OUTCOMES as [string, ...string[]]).optional(),
  is_published: z.boolean().optional(),
}).passthrough() // 允许其他字段更新

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// GET /api/cases/[id] - 详情（同时增加 view_count）
export async function GET(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    const id = await resolveIdParam(params)
    const { data, error } = await supabaseAdmin
      .from('case_library')
      .select('*')
      .eq('id', id)
      .single()

    if (error || !data) {
      return errorResponse('案例不存在', 404, 'NOT_FOUND')
    }

    // 异步增加查看次数（fire-and-forget）
    supabaseAdmin
      .from('case_library')
      .update({ view_count: (data.view_count || 0) + 1 })
      .eq('id', id)
      .then(() => {})

    return NextResponse.json(data)
  } catch (error) {
    console.error('Get case error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// PATCH /api/cases/[id] - 更新
export async function PATCH(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    await requireAuth(req)
    const id = await resolveIdParam(params)
    const body = await req.json()
    const result = caseUpdateSchema.safeParse(body)

    if (!result.success) {
      const firstError = result.error.issues[0]
      return errorResponse(firstError.message, 400, 'VALIDATION_ERROR')
    }

    const { data, error } = await supabaseAdmin
      .from('case_library')
      .update({ ...result.data, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('Update case error:', error)
      return errorResponse('更新失败', 500, 'DB_ERROR')
    }

    return NextResponse.json(data)
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    console.error('Update case error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// DELETE /api/cases/[id] - 删除
export async function DELETE(req: NextRequest, { params }: AsyncRouteParams) {
  try {
    await requireAuth(req)
    const id = await resolveIdParam(params)
    const { error } = await supabaseAdmin
      .from('case_library')
      .delete()
      .eq('id', id)

    if (error) {
      console.error('Delete case error:', error)
      return errorResponse('删除失败', 500, 'DB_ERROR')
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    console.error('Delete case error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
