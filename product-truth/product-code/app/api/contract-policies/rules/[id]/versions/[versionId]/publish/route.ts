// Single-rule publication is retired.  A rule becomes current only as a member
// of one atomic RuleSetSnapshot.

import { NextRequest } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { userHasFreshOrgConfigAccess } from '@/lib/configs/access'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; versionId: string }> }
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await userHasFreshOrgConfigAccess(user.id, orgId, 'publish')) {
      return errorResponse(createApiError('FORBIDDEN', '缺少当前组织的 config:publish 权限'))
    }

    const { id, versionId } = await params
    const { data: rule, error } = await supabaseAdmin
      .from('contract_rules_v2')
      .select('id, code, rule_set_id')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (error || !rule) {
      return errorResponse(createApiError('NOT_FOUND', '规则不存在'))
    }

    return errorResponse(createApiError(
      'CONFLICT',
      '单条规则发布已停用。请完成所属规则集的测试矩阵，再从规则集统一发布。',
      { rule_id: id, version_id: versionId, rule_set_id: rule.rule_set_id }
    ))
  })
}
