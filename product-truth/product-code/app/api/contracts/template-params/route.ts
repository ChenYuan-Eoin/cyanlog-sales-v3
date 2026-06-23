// GET /api/contracts/template-params
// 获取合同模板参数定义列表

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { successResponse } from '@/lib/api/common'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    const { searchParams } = new URL(req.url)
    const scenario = searchParams.get('scenario') || 'general'

    const { data: params, error } = await supabaseAdmin
      .from('contract_template_params')
      .select('*')
      .eq('org_id', orgId)
      .or(`applicable_scenario.eq.${scenario},applicable_scenario.eq.general`)
      .order('sort_order', { ascending: true })

    if (error) {
      return successResponse([])
    }

    return successResponse(params || [])
  })
}
