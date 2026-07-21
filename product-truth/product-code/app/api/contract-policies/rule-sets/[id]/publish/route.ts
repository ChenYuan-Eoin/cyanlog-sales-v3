import { NextRequest } from 'next/server'
import { z } from 'zod'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { userHasFreshOrgConfigAccess } from '@/lib/configs/access'
import { missingRulePublicationFields } from '@/lib/contracts/rule-publication'
import { supabaseAdmin } from '@/lib/supabase'

const schema = z.object({
  release_note: z.string().trim().max(1000).optional().nullable(),
}).strict()

function publicationErrorMessage(message: string) {
  const ruleCode = message.split(':')[1]?.split(/\s/)[0] || '规则'
  if ([
    'RULE_PUBLISHED_ACCEPTANCE_BINDING_MISSING',
    'RULE_PUBLISHED_ACCEPTANCE_DRAFT_INVALID',
    'RULE_PUBLISHED_ACCEPTANCE_BINDING_INVALID',
    'RULE_SET_CURRENT_SNAPSHOT_INVALID',
    'RULE_SET_FROZEN_ACCEPTANCE_INVALID',
  ].some((code) => message.includes(code))) {
    return '当前线上规则集验收证据链损坏，已阻止发布，请管理员恢复快照证据'
  }
  if (message.includes('RULE_SET_EMPTY')) return '规则集没有可发布的规则'
  if (message.includes('RULE_TEST_EVIDENCE_MISSING:')) {
    return `${message.split('RULE_TEST_EVIDENCE_MISSING:')[1]?.split(/\s/)[0] || '规则'} 缺少当前版本的测试记录`
  }
  if (message.includes('RULE_TEST_DECISION_MATRIX_MISSING:')) return `${ruleCode} 尚未通过每一条判定的验收用例`
  if (message.includes('RULE_TEST_MISSING_EVIDENCE_MISSING:')) return `${ruleCode} 尚未通过“缺少证据”验收`
  if (message.includes('RULE_TEST_VALUE_CONFLICT_MISSING:')) return `${ruleCode} 尚未通过“同文多值冲突”验收`
  if (message.includes('RULE_TEST_UNIT_CONFLICT_MISSING:')) return `${ruleCode} 尚未通过“币种冲突”验收`
  if (message.includes('RULE_DRAFT_SNAPSHOT_MISSING:')) return '规则草稿快照缺失，请重新保存后再发布'
  if (message.includes('RULE_PUBLISHED_SNAPSHOT_MISSING:')) return '已有发布规则缺少对应快照，已停止发布'
  if (message.includes('RULE_NOT_READY:')) return '规则集中仍有未完成的规则'
  if (message.includes('RULE_CANONICAL_CONTRACT_MISSING:')) return '规则集中仍有未完成的规则详情'
  return '规则集发布失败'
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'publish')) {
      return errorResponse(createApiError('FORBIDDEN', '缺少当前组织的 config:publish 权限'))
    }

    const parsed = schema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return errorResponse(createApiError('VALIDATION_ERROR', '发布参数无效'))
    }

    const { id } = await params
    const { data: ruleSet, error: ruleSetError } = await supabaseAdmin
      .from('contract_rule_sets')
      .select('id, name, lifecycle_status')
      .eq('id', id)
      .eq('org_id', orgId)
      .eq('is_active', true)
      .single()

    if (ruleSetError || !ruleSet) {
      return errorResponse(createApiError('NOT_FOUND', '规则集不存在'))
    }

    const { data: rules, error: rulesError } = await supabaseAdmin
      .from('contract_rules_v2')
      .select('*')
      .eq('org_id', orgId)
      .eq('rule_set_id', id)
      .eq('is_active', true)

    if (rulesError) {
      return errorResponse(createApiError('DB_ERROR', '读取规则集内容失败'))
    }
    if (!rules || rules.length === 0) {
      return errorResponse(createApiError('VALIDATION_ERROR', '规则集没有可发布的规则'))
    }
    const hasPendingRule = rules.some((rule) => !(
      rule.lifecycle_status === 'published'
      && rule.translation_status === 'ready'
      && rule.published_at
    ))
    if (ruleSet.lifecycle_status === 'published' && !hasPendingRule) {
      return errorResponse(createApiError('VALIDATION_ERROR', '规则集没有待发布变更'))
    }

    for (const rule of rules) {
      if (rule.lifecycle_status === 'published' && rule.translation_status === 'ready' && rule.published_at) {
        continue
      }
      const missing = missingRulePublicationFields(rule)
      if (missing.length > 0) {
        return errorResponse(createApiError(
          'VALIDATION_ERROR',
          `${rule.code || rule.name || '规则'} 尚不能发布：${missing.join('、')}`
        ))
      }
    }

    const { data, error } = await supabaseAdmin.rpc('publish_contract_rule_set_v1', {
      p_org_id: orgId,
      p_rule_set_id: id,
      p_user_id: user.id,
      p_release_note: parsed.data.release_note || null,
    })

    if (error || !data) {
      return errorResponse(createApiError(
        'VALIDATION_ERROR',
        publicationErrorMessage(error?.message || '')
      ))
    }

    return successResponse({
      ...data,
      message: `规则集“${ruleSet.name}”已发布`,
    })
  })
}
