import { NextRequest } from 'next/server'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import {
  formatProblemCategoryValidationError,
  PROBLEM_CATEGORY_SELECT,
  updateProblemCategorySchema,
} from '../schema'

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: RouteContext) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
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
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { id } = await params
    const parsed = updateProblemCategorySchema.safeParse(await req.json().catch(() => ({})))
    if (!parsed.success) {
      return errorResponse(createApiError(
        'VALIDATION_ERROR',
        `问题分类参数无效：${formatProblemCategoryValidationError(parsed.error)}`
      ))
    }

    const { data, error } = await supabaseAdmin
      .from('contract_rule_problem_categories')
      .update({
        ...parsed.data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .select(PROBLEM_CATEGORY_SELECT)
      .single()

    if (error || !data) {
      return errorResponse(createApiError('NOT_FOUND', '问题分类不存在'))
    }
    return successResponse(data)
  })
}

// Categories are stable audit references.  "Delete" therefore deactivates the
// category and preserves existing rule relationships.
export async function DELETE(req: NextRequest, { params }: RouteContext) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { id } = await params
    const { data, error } = await supabaseAdmin
      .from('contract_rule_problem_categories')
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .select('id')
      .single()

    if (error || !data) {
      return errorResponse(createApiError('NOT_FOUND', '问题分类不存在'))
    }
    return successResponse({ id })
  })
}
