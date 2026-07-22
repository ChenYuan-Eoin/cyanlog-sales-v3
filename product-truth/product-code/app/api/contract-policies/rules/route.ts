import { NextRequest } from 'next/server'

import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { createdResponse, errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import type { AuthUser } from '@/lib/auth'
import { ruleCreateSchema, sanitizeRuleMutation } from '@/lib/rules/rule-assets'
import { loadRuleSetAssets } from '@/lib/rules/rule-assets-server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    try {
      const ruleSetId = new URL(req.url).searchParams.get('rule_set_id')
      const payload = await loadRuleSetAssets(orgId)
      return successResponse(
        ruleSetId ? payload.rules.filter((rule) => rule.rule_set_id === ruleSetId) : payload.rules
      )
    } catch (error) {
      console.error('[contract-policy-rules] load failed', error)
      return errorResponse(createApiError('DB_ERROR', '获取规则失败'))
    }
  })
}

export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const body = await req.json().catch(() => ({}))
    const parsed = ruleCreateSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse(createApiError(
        'VALIDATION_ERROR',
        parsed.error.issues.map((issue) => issue.message).join('；')
      ))
    }

    const { data: ruleSet } = await supabaseAdmin
      .from('contract_rule_sets')
      .select('id')
      .eq('id', parsed.data.rule_set_id)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .maybeSingle()
    if (!ruleSet) return errorResponse(createApiError('NOT_FOUND', '所属规则集不存在'))

    const mutation = sanitizeRuleMutation(parsed.data)
    const { data, error } = await supabaseAdmin
      .from('contract_rules_v2')
      .insert({
        org_id: orgId,
        created_by: user.id,
        ...mutation,
        applicable_scenarios: mutation.applicable_scenarios || [],
        approval_roles: mutation.approval_roles || [],
        field_hints: mutation.field_hints || [],
        message_template: mutation.message_template || {},
        priority: mutation.priority ?? 0,
        is_active: mutation.is_active ?? true,
        version: 1,
        lifecycle_status: 'draft',
        translation_status: mutation.translation_status || 'needs_ai_translation',
      })
      .select('*')
      .single()

    if (error) {
      const duplicate = error.code === '23505'
      return errorResponse(createApiError(
        duplicate ? 'DUPLICATE_KEY' : 'DB_ERROR',
        duplicate ? '规则编码已存在' : '创建规则失败'
      ))
    }

    await supabaseAdmin
      .from('contract_rule_sets')
      .update({ lifecycle_status: 'draft', updated_at: new Date().toISOString() })
      .eq('id', parsed.data.rule_set_id)
      .eq('org_id', orgId)

    return createdResponse(data)
  })
}
