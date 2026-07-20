// GET /api/contract-policies/rules
// POST /api/contract-policies/rules
// 规则 CRUD。业务分类与属性类型分离；新写入协议以 rule_contract v1 为准。

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  errorResponse,
  successResponse,
  createdResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import {
  buildLegacyRuleAdapter,
  createRuleSchema,
  formatRuleValidationError,
  RULE_WITH_PROBLEM_CATEGORY_SELECT,
} from './rule-contract'

// GET - 规则列表
export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { searchParams } = new URL(req.url)
    const problemCategoryId = searchParams.get('problem_category_id')
    const isActive = searchParams.get('is_active')

    let query = supabaseAdmin
      .from('contract_rules_v2')
      .select(RULE_WITH_PROBLEM_CATEGORY_SELECT)
      .eq('org_id', orgId)
      .order('priority', { ascending: false })

    if (problemCategoryId) {
      query = query.eq('problem_category_id', problemCategoryId)
    }
    if (isActive !== null) {
      query = query.eq('is_active', isActive === 'true')
    } else {
      query = query.eq('is_active', true)
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
    const parsed = createRuleSchema.safeParse(body)

    if (!parsed.success) {
      return errorResponse(
        createApiError(
          'VALIDATION_ERROR',
          `规则参数无效：${formatRuleValidationError(parsed.error)}`
        )
      )
    }

    const { data: problemCategory, error: categoryError } = await supabaseAdmin
      .from('contract_rule_problem_categories')
      .select('id, code')
      .eq('id', parsed.data.problem_category_id)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .single()

    if (categoryError || !problemCategory) {
      return errorResponse(createApiError('VALIDATION_ERROR', '所选问题分类不存在或已停用'))
    }

    const legacyAdapter = buildLegacyRuleAdapter(parsed.data.rule_contract, problemCategory.code)

    const { data: rule, error } = await supabaseAdmin
      .from('contract_rules_v2')
      .insert({
        org_id: orgId,
        created_by: user.id,
        ...parsed.data,
        ...legacyAdapter,
        published_at: null,
        published_by: null,
        lifecycle_status: 'ready_to_publish',
        translation_status: 'ready',
        translation_notes: [],
        version: 1,
      })
      .select(RULE_WITH_PROBLEM_CATEGORY_SELECT)
      .single()

    if (error) {
      if (error.code === '23505') {
        return errorResponse(createApiError('DUPLICATE_KEY', '规则编码已存在'))
      }
      return errorResponse(createApiError('DB_ERROR', '创建规则失败'))
    }

    await supabaseAdmin.from('contract_rule_snapshots').insert({
      rule_id: rule.id,
      version: rule.version || 1,
      config_snapshot: rule,
      released_by: null,
      released_at: null,
      release_note: '创建 rule_contract v1 规则草稿，待测试后发布',
      status: 'draft',
    })

    return createdResponse(rule)
  })
}
