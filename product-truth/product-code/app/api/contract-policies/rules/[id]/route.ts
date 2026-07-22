import { NextRequest } from 'next/server'

import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import type { AuthUser } from '@/lib/auth'
import { ruleUpdateSchema, sanitizeRuleMutation } from '@/lib/rules/rule-assets'
import { loadRuleAsset } from '@/lib/rules/rule-assets-server'
import { supabaseAdmin } from '@/lib/supabase'

async function markRuleSetDraft(orgId: string, ruleSetId: string | null) {
  if (!ruleSetId) return
  await supabaseAdmin
    .from('contract_rule_sets')
    .update({ lifecycle_status: 'draft', updated_at: new Date().toISOString() })
    .eq('id', ruleSetId)
    .eq('org_id', orgId)
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { id } = await params
    try {
      const rule = await loadRuleAsset(orgId, id)
      if (!rule) return errorResponse(createApiError('NOT_FOUND', '规则不存在'))
      return successResponse(rule)
    } catch (error) {
      console.error('[contract-policy-rule] load failed', error)
      return errorResponse(createApiError('DB_ERROR', '获取规则失败'))
    }
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = ruleUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse(createApiError(
        'VALIDATION_ERROR',
        parsed.error.issues.map((issue) => issue.message).join('；')
      ))
    }

    const current = await loadRuleAsset(orgId, id)
    if (!current) return errorResponse(createApiError('NOT_FOUND', '规则不存在'))

    if (parsed.data.rule_set_id && parsed.data.rule_set_id !== current.rule_set_id) {
      const { data: targetSet } = await supabaseAdmin
        .from('contract_rule_sets')
        .select('id')
        .eq('id', parsed.data.rule_set_id)
        .eq('org_id', orgId)
        .eq('is_active', true)
        .maybeSingle()
      if (!targetSet) return errorResponse(createApiError('NOT_FOUND', '目标规则集不存在'))
    }

    const mutation = sanitizeRuleMutation(parsed.data)
    const translationStatus = mutation.translation_status || 'needs_ai_translation'
    const { data, error } = await supabaseAdmin
      .from('contract_rules_v2')
      .update({
        ...mutation,
        lifecycle_status: 'draft',
        translation_status: translationStatus,
        translated_at: translationStatus === 'ready' ? new Date().toISOString() : null,
        version: current.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single()

    if (error) {
      const duplicate = error.code === '23505'
      return errorResponse(createApiError(
        duplicate ? 'DUPLICATE_KEY' : 'DB_ERROR',
        duplicate ? '规则编码已存在' : '更新规则失败'
      ))
    }

    await Promise.all([
      markRuleSetDraft(orgId, current.rule_set_id),
      markRuleSetDraft(orgId, data.rule_set_id),
    ])
    return successResponse(data)
  })
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { id } = await params
    const current = await loadRuleAsset(orgId, id)
    if (!current) return errorResponse(createApiError('NOT_FOUND', '规则不存在'))

    const { error } = await supabaseAdmin
      .from('contract_rules_v2')
      .update({
        is_active: false,
        lifecycle_status: 'archived',
        version: current.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)

    if (error) return errorResponse(createApiError('DB_ERROR', '归档规则失败'))
    await markRuleSetDraft(orgId, current.rule_set_id)
    return successResponse({ id, lifecycle_status: 'archived' })
  })
}
