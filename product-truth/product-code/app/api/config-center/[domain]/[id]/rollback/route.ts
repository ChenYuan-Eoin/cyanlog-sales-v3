// REQ: F027-F036
// PURPOSE: 配置中心通用域 API（回滚）——Next 14 同步 params
import { NextRequest } from 'next/server'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { assertDomain, rollbackDomainItem, ConfigCenterError } from '@/lib/config-center/server'

export async function POST(req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  return withAuthAndOrg(req, async (_user, orgId) => {
    try {
      const domain = assertDomain(params.domain)
      const body = await req.json()
      const version = Number(body?.version)
      if (!Number.isInteger(version) || version < 1) {
        return errorResponse(createApiError('VALIDATION_ERROR', 'version 必须为正整数'))
      }
      await rollbackDomainItem(domain, orgId, params.id, version)
      return successResponse({ rolled_back_to: version })
    } catch (err) {
      if (err instanceof ConfigCenterError) {
        return errorResponse(createApiError('VALIDATION_ERROR', err.message))
      }
      return errorResponse(createApiError('DB_ERROR'))
    }
  })
}
