// REQ: F037-F046
// PURPOSE: 配置中心通用域 API（发布）——Next 15 async params
import { NextRequest } from 'next/server'
import { successResponse } from '@/lib/api/common'
import { assertDomain, publishDomainItem } from '@/lib/config-center/server'
import { withConfigCenterAccess } from '../../../access'

export async function POST(req: NextRequest, { params }: { params: Promise<{ domain: string; id: string }> }) {
  return withConfigCenterAccess(req, 'publish', async (_user, orgId) => {
    const { domain, id } = await params
    await publishDomainItem(assertDomain(domain), orgId, id)
    return successResponse({ published: true })
  })
}
