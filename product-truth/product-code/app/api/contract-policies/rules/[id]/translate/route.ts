// POST /api/contract-policies/rules/:id/translate
//
// Historical compatibility endpoint.  Rule configuration is now an explicit
// business contract (properties -> decisions -> handling).  AI participates at
// review runtime by locating source evidence and reading those properties; it
// must not translate a clear business rule into a second machine-owned draft.

import { NextRequest } from 'next/server'
import { errorResponse } from '@/lib/api/common'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { createApiError } from '@/lib/api/errors'
import type { AuthUser } from '@/lib/auth'
import { userHasFreshOrgConfigAccess } from '@/lib/configs/access'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'write')) {
      return errorResponse(createApiError('FORBIDDEN', '缺少当前组织的 config:write 权限'))
    }

    const { id } = await params
    const { data: rule, error } = await supabaseAdmin
      .from('contract_rules_v2')
      .select('id, code, name')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (error || !rule) {
      return errorResponse(createApiError('NOT_FOUND', '规则不存在'))
    }

    return errorResponse(createApiError(
      'CONFLICT',
      '规则配置不再使用 AI 转译。请在规则详情中明确维护业务属性、判定条件和处理方式；旧规则也必须由业务人员确认后保存为新规则草稿。',
      {
        rule_id: rule.id,
        rule_code: rule.code,
        replacement: 'rule_contract_editor',
        ai_boundary: 'runtime_property_reading_only',
      }
    ))
  })
}
