// REQ: F044
// PURPOSE: 报价冻结 → 生成结构化版本 + 中间快照（freeze_quote RPC）
// 未迁移库返回 409 MIGRATION_REQUIRED，不破坏现有流程
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { id } = await params

    const { data: quote } = await supabaseAdmin
      .from('quotes')
      .select('id, status, org_id, created_by')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle()

    if (!quote) {
      return errorResponse(createApiError('NOT_FOUND', '报价不存在'))
    }
    if (quote.status !== 'APPROVED') {
      return errorResponse(createApiError('VALIDATION_ERROR', '仅已批准的报价可冻结'))
    }

    const { data, error } = await supabaseAdmin.rpc('freeze_quote', {
      p_quote_id: id,
      p_user_id: user.id,
    })

    if (error) {
      if (/does not exist|relation|PGRST/i.test(error.message)) {
        return errorResponse(createApiError('VALIDATION_ERROR', '数据库尚未升级报价版本/快照结构，请先执行 migration 20260814000002'), 409)
      }
      console.error('Freeze quote error:', error)
      return errorResponse(createApiError('DB_ERROR', error.message))
    }

    return NextResponse.json({ success: true, data: { version_id: data } })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    console.error('Freeze quote error:', error)
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}
