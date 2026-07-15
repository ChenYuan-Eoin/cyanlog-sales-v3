// REQ: F003 自主可控 + RBAC
// PURPOSE: 全局系统角色只读边界

import { NextRequest } from 'next/server'
import type { AsyncRouteParams } from '@/lib/route-params'
import { errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { userHasOrgConfigAccess } from '@/lib/configs/access'

// Roles are currently a global dictionary without org ownership. Any tenant-side
// mutation would affect every organization and could rewrite the caller's own
// authorization source. Keep the public mutation surface closed until roles are
// made organization-owned (or moved to a separate platform control plane).
export async function PATCH(
  req: NextRequest,
  _context: AsyncRouteParams
) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await userHasOrgConfigAccess(user.id, orgId, 'write')) {
      return errorResponse(createApiError('FORBIDDEN'))
    }

    return errorResponse(createApiError(
      'CONFLICT',
      '系统角色是全局只读模板；组织级角色模型完成前禁止在线修改。'
    ))
  })
}
