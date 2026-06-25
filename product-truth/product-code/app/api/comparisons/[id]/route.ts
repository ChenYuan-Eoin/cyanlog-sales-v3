// GET /api/comparisons/:id
// 获取比对结果详情

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { listAccessibleUserIds } from '@/lib/scoped-access'
import type { AuthUser } from '@/lib/auth'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { id } = await params
    const { userIds: accessibleUserIds } = await listAccessibleUserIds(user.id, orgId)

    // 1. 获取比对任务
    const { data: comparison, error: compError } = await supabaseAdmin
      .from('contract_comparisons')
      .select('*, contracts!inner(id, org_id, created_by)')
      .eq('id', id)
      .eq('contracts.org_id', orgId)
      .in('contracts.created_by', accessibleUserIds)
      .single()

    if (compError || !comparison) {
      return errorResponse(createApiError('NOT_FOUND', '比对记录不存在'))
    }

    // 2. 获取差异项
    const { data: diffs, error: diffsError } = await supabaseAdmin
      .from('comparison_diffs')
      .select('*')
      .eq('comparison_id', id)
      .order('sort_order', { ascending: true })

    if (diffsError) {
      return errorResponse(createApiError('DB_ERROR', '获取差异项失败'))
    }

    return successResponse({
      ...comparison,
      diffs: diffs || [],
    })
  })
}
