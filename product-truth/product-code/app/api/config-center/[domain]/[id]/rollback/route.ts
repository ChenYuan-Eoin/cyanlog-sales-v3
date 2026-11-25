// REQ: F037-F046
// PURPOSE: 配置中心通用域 API（回滚）——Next 15 async params
import { NextRequest } from 'next/server'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { assertDomain, rollbackDomainItem } from '@/lib/config-center/server'
import { withConfigCenterAccess } from '../../../access'

export async function POST(req: NextRequest, { params }: { params: Promise<{ domain: string; id: string }> }) {
  return withConfigCenterAccess(req, 'write', async (_user, orgId, access) => {
    const { domain, id } = await params
    const body = await req.json()
    const version = Number(body?.version)
    if (!Number.isInteger(version) || version < 1) {
      return errorResponse(createApiError('VALIDATION_ERROR', 'version 必须为正整数'))
    }
    await rollbackDomainItem(assertDomain(domain), orgId, id, version, access.canPublish)
    return successResponse({ rolled_back_to: version })
  })
}
