import { NextRequest } from 'next/server'

import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import type { AuthUser } from '@/lib/auth'
import { ruleSetUpdateSchema } from '@/lib/rules/rule-assets'
import { supabaseAdmin } from '@/lib/supabase'

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const parsed = ruleSetUpdateSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse(createApiError(
        'VALIDATION_ERROR',
        parsed.error.issues.map((issue) => issue.message).join('；')
      ))
    }

    const { data: current } = await supabaseAdmin
      .from('contract_rule_sets')
      .select('id')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (!current) return errorResponse(createApiError('NOT_FOUND', '规则集不存在'))

    const { data, error } = await supabaseAdmin
      .from('contract_rule_sets')
      .update({
        ...parsed.data,
        lifecycle_status: 'draft',
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
        duplicate ? '规则集编码已存在' : '更新规则集失败'
      ))
    }
    return successResponse(data)
  })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return withAuthAndOrg(req, async (_user: AuthUser, orgId: string) => {
    const { id } = await params
    const { data, error } = await supabaseAdmin.rpc('archive_contract_rule_set_v1', {
      p_org_id: orgId,
      p_rule_set_id: id,
    })

    if (error) return errorResponse(createApiError('DB_ERROR', '归档规则集失败'))
    return successResponse(data)
  })
}
