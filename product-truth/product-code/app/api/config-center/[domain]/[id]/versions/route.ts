// REQ: F027-F036
// PURPOSE: 配置中心通用域 API（版本历史）——Next 14 同步 params
import { NextRequest } from 'next/server'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { assertDomain, listVersions, ConfigCenterError } from '@/lib/config-center/server'

export async function GET(req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  return withAuthAndOrg(req, async (_user, orgId) => {
    try {
      const domain = assertDomain(params.domain)
      const versions = await listVersions(domain, orgId, params.id)
      return successResponse(versions)
    } catch (err) {
      if (err instanceof ConfigCenterError) {
        return errorResponse(createApiError('VALIDATION_ERROR', err.message))
      }
      return errorResponse(createApiError('DB_ERROR'))
    }
  })
}
