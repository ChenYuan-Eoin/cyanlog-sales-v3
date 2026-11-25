// REQ: F037-F046
// PURPOSE: 配置中心通用域 API（版本历史）——Next 15 async params
import { NextRequest } from 'next/server'
import { successResponse } from '@/lib/api/common'
import { assertDomain, listVersions } from '@/lib/config-center/server'
import { withConfigCenterAccess } from '../../../access'

export async function GET(req: NextRequest, { params }: { params: Promise<{ domain: string; id: string }> }) {
  return withConfigCenterAccess(req, 'read', async (_user, orgId) => {
    const { domain, id } = await params
    const versions = await listVersions(assertDomain(domain), orgId, id)
    return successResponse(versions)
  })
}
