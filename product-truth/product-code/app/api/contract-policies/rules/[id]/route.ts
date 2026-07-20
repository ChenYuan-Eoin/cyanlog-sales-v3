// /api/contract-policies/rules/:id
// GET / PATCH / DELETE 单条规则

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  errorResponse,
  successResponse,
} from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import {
  buildLegacyRuleAdapter,
  formatRuleValidationError,
  RULE_WITH_PROBLEM_CATEGORY_SELECT,
  updateRuleSchema,
} from '../rule-contract'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params

    const { data: rule, error } = await supabaseAdmin
      .from('contract_rules_v2')
      .select(RULE_WITH_PROBLEM_CATEGORY_SELECT)
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (error || !rule) {
      return errorResponse(createApiError('NOT_FOUND', '规则不存在'))
    }

    return successResponse(rule)
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = updateRuleSchema.safeParse(body)

    if (!parsed.success) {
      return errorResponse(
        createApiError('VALIDATION_ERROR', `规则参数无效：${formatRuleValidationError(parsed.error)}`)
      )
    }

    const { data: oldRule } = await supabaseAdmin
      .from('contract_rules_v2')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (!oldRule) {
      return errorResponse(createApiError('NOT_FOUND', '规则不存在'))
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

    const nextVersion = (oldRule.version || 1) + 1
    const { data: rule, error } = await supabaseAdmin
      .from('contract_rules_v2')
      .update({
        ...parsed.data,
        ...legacyAdapter,
        version: nextVersion,
        published_at: null,
        published_by: null,
        lifecycle_status: 'ready_to_publish',
        translation_status: 'ready',
        translation_notes: [],
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .select(RULE_WITH_PROBLEM_CATEGORY_SELECT)
      .single()

    if (error || !rule) {
      return errorResponse(createApiError('DB_ERROR', '更新规则失败'))
    }

    await supabaseAdmin.from('contract_rule_snapshots').insert({
      rule_id: id,
      version: nextVersion,
      config_snapshot: rule,
      released_by: null,
      released_at: null,
      release_note: '保存 rule_contract v1 规则草稿，待测试后发布',
      status: 'draft',
    })

    return successResponse(rule)
  })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params

    const { data: oldRule } = await supabaseAdmin
      .from('contract_rules_v2')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    const nextVersion = (oldRule?.version || 1) + 1
    const { data: rule, error } = await supabaseAdmin
      .from('contract_rules_v2')
      .update({
        is_active: false,
        version: nextVersion,
        lifecycle_status: 'archived',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '删除规则失败'))
    }

    if (rule) {
      await supabaseAdmin.from('contract_rule_snapshots').insert({
        rule_id: id,
        version: nextVersion,
        config_snapshot: rule,
        released_by: user.id,
        released_at: new Date().toISOString(),
        release_note: '停用规则',
        status: 'rolled_back',
      })
    }

    return successResponse({ id })
  })
}
