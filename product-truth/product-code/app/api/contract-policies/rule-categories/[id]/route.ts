import { NextRequest } from 'next/server'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { userHasFreshOrgConfigAccess } from '@/lib/configs/access'
import { supabaseAdmin } from '@/lib/supabase'
import {
  formatProblemCategoryValidationError,
  PROBLEM_CATEGORY_SELECT,
  updateProblemCategorySchema,
} from '../schema'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: RouteContext) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'read')) {
      return errorResponse(createApiError('FORBIDDEN', '缺少当前组织的 config:read 权限'))
    }

    const { id } = await params
    const { data, error } = await supabaseAdmin
      .from('contract_rule_problem_categories')
      .select(PROBLEM_CATEGORY_SELECT)
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (error || !data) {
      return errorResponse(createApiError('NOT_FOUND', '问题分类不存在'))
    }
    return successResponse(data)
  })
}

export async function PATCH(req: NextRequest, { params }: RouteContext) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'write')) {
      return errorResponse(createApiError('FORBIDDEN', '缺少当前组织的 config:write 权限'))
    }

    const { id } = await params
    const parsed = updateProblemCategorySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return errorResponse(createApiError(
        'VALIDATION_ERROR',
        `问题分类参数无效：${formatProblemCategoryValidationError(parsed.error)}`
      ))
    }

    const { data, error } = await supabaseAdmin.rpc('update_contract_rule_problem_category_v1', {
      p_org_id: orgId,
      p_user_id: user.id,
      p_category_id: id,
      p_payload: parsed.data,
    })

    if (error?.message?.includes('RULE_CATEGORY_ACTIVE_REFERENCES')) {
      return errorResponse(createApiError('CONFLICT', '该问题分类仍被启用规则引用，请先停用或迁移这些规则'))
    }
    if (error?.message?.includes('RULE_PROBLEM_CATEGORY_NOT_FOUND')) {
      return errorResponse(createApiError('NOT_FOUND', '问题分类不存在'))
    }
    if (error) {
      return errorResponse(createApiError('DB_ERROR', '更新问题分类失败'))
    }
    if (!data) {
      return errorResponse(createApiError('NOT_FOUND', '问题分类不存在'))
    }
    return successResponse(data)
  })
}

// Categories are stable audit references.  "Delete" therefore deactivates the
// category and preserves existing rule relationships.
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'write')) {
      return errorResponse(createApiError('FORBIDDEN', '缺少当前组织的 config:write 权限'))
    }

    const { id } = await params
    const { data, error } = await supabaseAdmin.rpc('update_contract_rule_problem_category_v1', {
      p_org_id: orgId,
      p_user_id: user.id,
      p_category_id: id,
      p_payload: { is_active: false },
    })

    if (error?.message?.includes('RULE_CATEGORY_ACTIVE_REFERENCES')) {
      return errorResponse(createApiError('CONFLICT', '该问题分类仍被启用规则引用，请先停用或迁移这些规则'))
    }
    if (error?.message?.includes('RULE_PROBLEM_CATEGORY_NOT_FOUND')) {
      return errorResponse(createApiError('NOT_FOUND', '问题分类不存在'))
    }
    if (error) {
      return errorResponse(createApiError('DB_ERROR', '停用问题分类失败'))
    }
    if (!data) {
      return errorResponse(createApiError('NOT_FOUND', '问题分类不存在'))
    }
    return successResponse({ id })
  })
}
