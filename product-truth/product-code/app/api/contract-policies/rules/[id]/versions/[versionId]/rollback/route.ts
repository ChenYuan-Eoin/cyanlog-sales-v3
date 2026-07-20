// Single-rule rollback is retired.  Restoring one rule without the rest of its
// released set would manufacture a mixed production baseline.

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
      '单条规则回滚已停用。请选择一个完整规则集版本恢复，避免线上再次混入不同基线。',
      { rule_id: id, version_id: versionId, rule_set_id: rule.rule_set_id }
    ))
  })
}
