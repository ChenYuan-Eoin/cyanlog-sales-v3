// REQ: F037-F046
// PURPOSE: 配置中心通用域 API（发布）——Next 15 async params
import { NextRequest } from 'next/server'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { assertDomain, publishDomainItem, ConfigCenterError } from '@/lib/config-center/server'

export async function POST(req: NextRequest, { params }: { params: Promise<{ domain: string; id: string }> }) {
  return withAuthAndOrg(req, async (_user, orgId) => {
    try {
      const domain = assertDomain((await params).domain)
      await publishDomainItem(domain, orgId, (await params).id)
      return successResponse({ published: true })
    } catch (err) {
      if (err instanceof ConfigCenterError) {
        return errorResponse(createApiError('VALIDATION_ERROR', err.message))
      }
      return errorResponse(createApiError('DB_ERROR'))
    }
  })
}
