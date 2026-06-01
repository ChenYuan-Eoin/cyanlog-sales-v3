// REQ:F006
// PURPOSE: Rule configuration API - list, create, update, delete rules

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { z } from 'zod'

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

// GET /api/rules - 获取规则列表（需登录）
export async function GET(req: NextRequest) {
  try {
    await requireAuth(req)

    const { searchParams } = new URL(req.url)
    const ruleType = searchParams.get('rule_type')
    const enabled = searchParams.get('enabled')

    let query = supabaseAdmin
      .from('rules')
      .select('*')
      .order('created_at', { ascending: false })

    if (ruleType) {
      query = query.eq('rule_type', ruleType)
    }

    if (enabled !== null) {
      query = query.eq('enabled', enabled === 'true')
    }

    const { data: rules, error } = await query

    if (error) {
      console.error('Get rules error:', error)
      return errorResponse('查询失败', 500, 'DB_ERROR')
    }

    return NextResponse.json(rules)
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

    const body = await req.json()
    const validated = ruleSchema.safeParse(body)

    if (!validated.success) {
      return errorResponse('规则数据无效: ' + validated.error.errors.map(e => e.message).join(', '), 400, 'INVALID_DATA')
    }

    const { data: rule, error } = await supabaseAdmin
      .from('rules')
      .insert({
        ...validated.data,
        created_by: user.id,
      })
      .select()
      .single()

    if (error) {
      console.error('Create rule error:', error)
      return errorResponse('创建规则失败', 500, 'DB_ERROR')
    }

    return NextResponse.json(rule, { status: 201 })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse('未登录或登录已过期', 401, 'UNAUTHORIZED')
    }
    console.error('Create rule error:', error)
    return errorResponse('服务器内部错误', 500, 'INTERNAL_ERROR')
  }
}
