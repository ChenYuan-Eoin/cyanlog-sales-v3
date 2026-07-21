import crypto from 'node:crypto'
import { NextRequest } from 'next/server'
import { createdResponse, errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { userHasFreshOrgConfigAccess } from '@/lib/configs/access'
import { supabaseAdmin } from '@/lib/supabase'
import {
  createProblemCategorySchema,
  formatProblemCategoryValidationError,
  PROBLEM_CATEGORY_SELECT,
} from './schema'

// GET /api/contract-policies/rule-categories
// Stable organization-scoped business problem categories.  Property types such
// as money/percentage/duration live inside a rule's rule_contract instead.
export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'read')) {
      return errorResponse(createApiError('FORBIDDEN', '缺少当前组织的 config:read 权限'))
    }

    const includeInactive = new URL(req.url).searchParams.get('include_inactive') === 'true'
    let query = supabaseAdmin
      .from('contract_rule_problem_categories')
      .select(PROBLEM_CATEGORY_SELECT)
      .eq('org_id', orgId)
      .order('sort_order', { ascending: true })
      .order('code', { ascending: true })

    if (!includeInactive) {
      query = query.eq('is_active', true)
    }

    const { data, error } = await query
    if (error) {
      return errorResponse(createApiError('DB_ERROR', '获取问题分类失败'))
    }

    return successResponse(data || [])
  })
}

// POST /api/contract-policies/rule-categories
export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'write')) {
      return errorResponse(createApiError('FORBIDDEN', '缺少当前组织的 config:write 权限'))
    }

    const parsed = createProblemCategorySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return errorResponse(createApiError(
        'VALIDATION_ERROR',
        `问题分类参数无效：${formatProblemCategoryValidationError(parsed.error)}`
      ))
    }

    const { data, error } = await supabaseAdmin
      .from('contract_rule_problem_categories')
      .insert({
        org_id: orgId,
        created_by: user.id,
        ...parsed.data,
        code: parsed.data.code || `category_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
      })
      .select(PROBLEM_CATEGORY_SELECT)
      .single()

    if (error) {
      if (error.code === '23505') {
        return errorResponse(createApiError('DUPLICATE_KEY', '问题分类编码已存在'))
      }
      return errorResponse(createApiError('DB_ERROR', '创建问题分类失败'))
    }

    return createdResponse(data)
  })
}
