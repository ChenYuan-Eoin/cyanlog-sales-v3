// GET /api/contract-policies/rules
// POST /api/contract-policies/rules
// 属性化规则 CRUD（Tier 1 可索引性）

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { z } from 'zod'
import {
  errorResponse,
  successResponse,
  createdResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'

// 规则创建/更新验证
const ruleSchema = z.object({
  code: z.string().min(1, '规则编码不能为空'),
  name: z.string().min(1, '规则名称不能为空'),
  description: z.string().optional(),
  category: z.enum(['ratio', 'amount', 'duration', 'enum', 'text']),
  applicable_scenarios: z.array(z.string()).optional(),
  scope: z.enum(['org', 'dept', 'user']).optional(),

  // Level A
  level_a_operator: z.enum(['>=', '<=', '=', '>', '<', 'contains', 'in']),
  level_a_threshold: z.number(),
  level_a_unit: z.string().optional(),
  level_a_action: z.string().optional(),

  // Level B
  level_b_operator: z.enum(['>=', '<=', '=', '>', '<', 'contains', 'in']),
  level_b_threshold: z.number(),
  level_b_unit: z.string().optional(),
  level_b_action: z.string().optional(),
  level_b_counterparty: z.string().optional(),

  // Level C
  level_c_operator: z.enum(['>=', '<=', '=', '>', '<', 'contains', 'in']),
  level_c_threshold: z.number(),
  level_c_unit: z.string().optional(),
  level_c_action: z.string().optional(),
  level_c_message: z.string().optional(),

  // 其他
  approval_roles: z.array(z.string()).optional(),
  script_id: z.string().uuid().optional(),
  priority: z.number().optional(),
  is_active: z.boolean().optional(),
})

// GET - 规则列表
export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { searchParams } = new URL(req.url)
    const category = searchParams.get('category')
    const isActive = searchParams.get('is_active')

    let query = supabaseAdmin
      .from('contract_rules_v2')
      .select('*')
      .eq('org_id', orgId)
      .order('priority', { ascending: false })

    if (category) {
      query = query.eq('category', category)
    }
    if (isActive !== null) {
      query = query.eq('is_active', isActive === 'true')
    }

    const { data: rules, error } = await query

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '获取规则失败'))
    }

    return successResponse(rules || [])
  })
}

// POST - 创建规则
export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const body = await req.json().catch(() => ({}))
    const parsed = ruleSchema.safeParse(body)

    if (!parsed.success) {
      return errorResponse(
        createApiError(
          'VALIDATION_ERROR',
          `参数验证失败: ${parsed.error.issues.map((e) => e.message).join(', ')}`
        )
      )
    }

    const { data: rule, error } = await supabaseAdmin
      .from('contract_rules_v2')
      .insert({
        org_id: orgId,
        created_by: user.id,
        ...parsed.data,
        version: 1,
      })
      .select()
      .single()

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '创建规则失败'))
    }

    return createdResponse(rule)
  })
}
