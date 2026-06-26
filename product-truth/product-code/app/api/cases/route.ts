// POST /api/cases - 创建案例
// GET /api/cases - 列表（分页 + 过滤）
// F015 案例库管理

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { OUTCOMES, DIFFICULTIES } from '@/lib/case-library/types'

export const runtime = 'nodejs'

const caseCreateSchema = z.object({
  title: z.string().min(2).max(200),
  customer_name: z.string().min(1).max(100),
  industry: z.string().min(1).max(50),
  product: z.string().min(1).max(50),
  amount: z.number().min(0).nullable().optional(),
  duration_months: z.number().int().min(0).max(120).nullable().optional(),
  difficulty: z.enum(DIFFICULTIES as [string, ...string[]]).optional(),
  outcome: z.enum(OUTCOMES as [string, ...string[]]),
  background: z.string().max(5000).optional(),
  challenge: z.string().max(5000).optional(),
  solution: z.string().max(5000).optional(),
  success_factors: z.string().max(5000).optional(),
  lessons_learned: z.string().max(5000).optional(),
  tags: z.array(z.string().min(1).max(30)).max(20).optional(),
  is_published: z.boolean().optional(),
})

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
  outcome: z.enum(OUTCOMES as [string, ...string[]]).optional(),
  industry: z.string().optional(),
  product: z.string().optional(),
  search: z.string().optional(),
})

function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// GET /api/cases - 列表
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req)
    const { searchParams } = new URL(req.url)

    const queryParse = listQuerySchema.safeParse({
      page: searchParams.get('page') || 1,
      pageSize: searchParams.get('pageSize') || 20,
      outcome: searchParams.get('outcome') || undefined,
      industry: searchParams.get('industry') || undefined,
      product: searchParams.get('product') || undefined,
      search: searchParams.get('search') || undefined,
    })

    if (!queryParse.success) {
      return errorResponse('查询参数无效', 400, 'INVALID_QUERY')
    }

    const { page, pageSize, outcome, industry, product, search } = queryParse.data

    let q = supabaseAdmin
      .from('case_library')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })

    if (outcome) q = q.eq('outcome', outcome)
    if (industry) q = q.eq('industry', industry)
    if (product) q = q.eq('product', product)
    if (search) q = q.or(`title.ilike.%${search}%,customer_name.ilike.%${search}%`)

    const { data, error, count } = await q.range((page - 1) * pageSize, page * pageSize - 1)

    if (error) {
      console.error('List cases error:', error)
      return errorResponse('查询失败', 500, 'DB_ERROR')
    }

    return NextResponse.json({
      data,
      meta: { page, pageSize, total: count || 0 },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    console.error('List cases error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// POST /api/cases - 创建
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const body = await req.json().catch(() => null)
    const result = caseCreateSchema.safeParse(body)

    if (!result.success) {
      const firstError = result.error.issues[0]
      return errorResponse(firstError.message, 400, 'VALIDATION_ERROR')
    }

    const input = result.data
    const { data, error } = await supabaseAdmin
      .from('case_library')
      .insert({
        ...input,
        difficulty: input.difficulty || 'MEDIUM',
        is_published: input.is_published || false,
        tags: input.tags || [],
        view_count: 0,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) {
      console.error('Create case error:', error)
      return errorResponse('创建失败', 500, 'DB_ERROR')
    }

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    console.error('Create case error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
