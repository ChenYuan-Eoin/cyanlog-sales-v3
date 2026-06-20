// REQ:F006
// PURPOSE: Rule configuration API - list, create, update, delete rules

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { z } from 'zod'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { isSchemaDriftError } from '@/lib/db-compat'

// 统一错误响应
function errorResponse(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status })
}

// Rule validation schema
const ruleSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional(),
  rule_type: z.enum(['structured', 'semantic']),
  risk_level: z.enum(['red', 'yellow', 'green']),
  enabled: z.boolean().default(true),
  config: z.object({
    pattern: z.string().optional(),
    field: z.string().optional(),
    operator: z.enum(['gt', 'lt', 'eq', 'contains']).optional(),
    value: z.union([z.string(), z.number()]).optional(),
    prompt: z.string().optional(),
  }).optional(),
})

// GET /api/rules - 获取规则列表（需登录，分页）
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req)

    const { searchParams } = new URL(req.url)
    const ruleType = searchParams.get('rule_type')
    const enabled = searchParams.get('enabled')
    // 分页参数
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    let query = supabaseAdmin
      .from('rules')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (ruleType) {
      query = query.eq('rule_type', ruleType)
    }

    if (enabled !== null) {
      query = query.eq('enabled', enabled === 'true')
    }

    let { data: rules, error, count } = await query

    if (error) {
      console.error('Get rules error:', error)
      return errorResponse('查询失败', 500, 'DB_ERROR')
    }

    return NextResponse.json({
      data: rules,
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: (count || 0) > offset + limit,
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Get rules error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}

// POST /api/rules - 创建规则（需登录）
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)

    const body = await req.json()
    const validated = ruleSchema.safeParse(body)

    if (!validated.success) {
      return errorResponse('规则数据无效: ' + validated.error.issues.map((e: { message: string }) => e.message).join(', '), 400, 'INVALID_DATA')
    }

    let insertResult = await supabaseAdmin
      .from('rules')
      .insert({
        ...validated.data,
        org_id: orgId,
        created_by: user.id,
      })
      .select()
      .single()

    if (insertResult.error && isSchemaDriftError(insertResult.error)) {
      insertResult = await supabaseAdmin
        .from('rules')
        .insert({
          ...validated.data,
          created_by: user.id,
        })
        .select()
        .single()
    }

    if (insertResult.error) {
      console.error('Create rule error:', insertResult.error)
      return errorResponse('创建规则失败', 500, 'DB_ERROR')
    }

    return NextResponse.json(insertResult.data, { status: 201 })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Create rule error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
