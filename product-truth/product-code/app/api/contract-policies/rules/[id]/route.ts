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
import { userHasFreshOrgConfigAccess } from '@/lib/configs/access'
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
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'read')) {
      return errorResponse(createApiError('FORBIDDEN', '缺少当前组织的 config:read 权限'))
    }

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
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'write')) {
      return errorResponse(createApiError('FORBIDDEN', '缺少当前组织的 config:write 权限'))
    }

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
    if (oldRule.rule_set_id !== parsed.data.rule_set_id) {
      return errorResponse(createApiError('VALIDATION_ERROR', '已保存规则不能直接跨规则集移动；请在目标规则集中新建并单独发布'))
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
    // PATCH is intentionally partial at the HTTP boundary, while the atomic
    // draft RPC writes a complete projection.  Merge the current row first so
    // omitted optional fields are preserved instead of becoming NULL/defaults.
    // Zod defaults may appear in parsed.data even when the request omitted the
    // field, so only copy keys that the caller actually sent.
    const explicitlyProvided = Object.fromEntries(
      Object.entries(parsed.data).filter(([key]) => Object.prototype.hasOwnProperty.call(body, key))
    )
    const completePayload = {
      ...oldRule,
      ...explicitlyProvided,
      rule_set_id: parsed.data.rule_set_id,
      problem_category_id: parsed.data.problem_category_id,
      rule_contract: parsed.data.rule_contract,
    }

    const { data: saved, error } = await supabaseAdmin.rpc('save_contract_rule_draft_v1', {
      p_org_id: orgId,
      p_user_id: user.id,
      p_rule_id: id,
      p_payload: { ...completePayload, ...legacyAdapter },
    })

    if (error?.message?.includes('RULE_DRAFT_VERSION_CONFLICT')) {
      return errorResponse(createApiError(
        'CONFLICT',
        '这条规则已在其他页面更新，请刷新后基于最新版本重新修改'
      ))
    }
    if (error || !saved) {
      return errorResponse(createApiError('DB_ERROR', '更新规则失败'))
    }

    const { data: rule, error: readError } = await supabaseAdmin
      .from('contract_rules_v2')
      .select(RULE_WITH_PROBLEM_CATEGORY_SELECT)
      .eq('id', id)
      .eq('org_id', orgId)
      .single()
    if (readError || !rule) {
      return errorResponse(createApiError('DB_ERROR', '规则草稿已保存，但读取结果失败'))
    }

    return successResponse(rule)
  })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'write')) {
      return errorResponse(createApiError('FORBIDDEN', '缺少当前组织的 config:write 权限'))
    }

    const { id } = await params

    const { data: rule, error } = await supabaseAdmin.rpc('archive_contract_rule_draft_v1', {
      p_org_id: orgId,
      p_user_id: user.id,
      p_rule_id: id,
    })

    if (error) {
      return errorResponse(createApiError('DB_ERROR', '删除规则失败'))
    }

    return successResponse({ id, pending_rule_set_publish: Boolean(rule) })
  })
}
