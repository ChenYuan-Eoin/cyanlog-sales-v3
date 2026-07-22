import { NextRequest } from 'next/server'

import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { createdResponse, errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import type { AuthUser } from '@/lib/auth'
import { loadRuleSetAssets } from '@/lib/rules/rule-assets-server'
import { ruleSetCreateSchema } from '@/lib/rules/rule-assets'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    try {
      const includeArchived = new URL(req.url).searchParams.get('include_archived') === 'true'
      return successResponse(await loadRuleSetAssets(orgId, includeArchived))
    } catch (error) {
      console.error('[rule-sets] load failed', error)
      return errorResponse(createApiError('DB_ERROR', '获取规则资产失败'))
    }
  })
}

export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const body = await req.json().catch(() => ({}))
    const parsed = ruleSetCreateSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse(createApiError(
        'VALIDATION_ERROR',
        parsed.error.issues.map((issue) => issue.message).join('；')
      ))
    }

    const { data, error } = await supabaseAdmin
      .from('contract_rule_sets')
      .insert({
        org_id: orgId,
        created_by: user.id,
        ...parsed.data,
        priority: parsed.data.priority ?? 0,
        lifecycle_status: 'draft',
        translation_status: 'not_started',
      })
      .select('*')
      .single()

    if (error) {
      const duplicate = error.code === '23505'
      return errorResponse(createApiError(
        duplicate ? 'DUPLICATE_KEY' : 'DB_ERROR',
        duplicate ? '规则集编码已存在' : '创建规则集失败'
      ))
    }

    return createdResponse({ ...data, rules: [] })
  })
}
