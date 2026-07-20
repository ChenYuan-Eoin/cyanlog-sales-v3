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
import { userHasFreshOrgConfigAccess } from '@/lib/configs/access'
import {
  buildLegacyRuleAdapter,
  createRuleSchema,
  formatRuleValidationError,
  RULE_WITH_PROBLEM_CATEGORY_SELECT,
} from './rule-contract'

// GET - 规则列表
export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'read')) {
      return errorResponse(createApiError('FORBIDDEN', '缺少当前组织的 config:read 权限'))
    }

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
      // Keep pending removals visible until their RuleSet is published. Rows
      // become archived only after the membership snapshot has been replaced.
      query = query.neq('lifecycle_status', 'archived')
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
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'write')) {
      return errorResponse(createApiError('FORBIDDEN', '缺少当前组织的 config:write 权限'))
    }

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

    const { data: ruleSet, error: ruleSetError } = await supabaseAdmin
      .from('contract_rule_sets')
      .select('id')
      .eq('id', parsed.data.rule_set_id)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .single()

    if (ruleSetError || !ruleSet) {
      return errorResponse(createApiError('VALIDATION_ERROR', '所选规则集不存在或已停用'))
    }

    const legacyAdapter = buildLegacyRuleAdapter(parsed.data.rule_contract, problemCategory.code)

    const { data: saved, error } = await supabaseAdmin.rpc('save_contract_rule_draft_v1', {
      p_org_id: orgId,
      p_user_id: user.id,
      p_rule_id: null,
      p_payload: { ...parsed.data, ...legacyAdapter },
    })

    if (error || !saved || typeof saved !== 'object') {
      if (error?.code === '23505') {
        return errorResponse(createApiError('DUPLICATE_KEY', '规则编码已存在'))
      }
      return errorResponse(createApiError('DB_ERROR', '创建规则失败'))
    }

    const savedId = (saved as { id?: string }).id
    const { data: rule, error: readError } = await supabaseAdmin
      .from('contract_rules_v2')
      .select(RULE_WITH_PROBLEM_CATEGORY_SELECT)
      .eq('id', savedId)
      .eq('org_id', orgId)
      .single()
    if (readError || !rule) {
      return errorResponse(createApiError('DB_ERROR', '规则草稿已保存，但读取结果失败'))
    }

    return createdResponse(rule)
  })
}
