// REQ: F037-F046
// PURPOSE: 配置中心通用域 API（详情/更新/删除）——Next 15 async params
import { NextRequest } from 'next/server'
import { successResponse, noContentResponse } from '@/lib/api/common'
import { assertDomain, getDomainItem, updateDomainItem, deleteDomainItem, validateDomainPayload } from '@/lib/config-center/server'
import { withConfigCenterAccess } from '../../access'

export async function GET(req: NextRequest, { params }: { params: Promise<{ domain: string; id: string }> }) {
  return withConfigCenterAccess(req, 'read', async (_user, orgId) => {
    const { domain, id } = await params
    const item = await getDomainItem(assertDomain(domain), orgId, id)
    return successResponse(item)
  })
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ domain: string; id: string }> }) {
  return withConfigCenterAccess(req, 'write', async (_user, orgId, access) => {
    const { domain: domainName, id } = await params
    const domain = assertDomain(domainName)
    const payload = validateDomainPayload(domain, await req.json())
    const item = await updateDomainItem(domain, orgId, id, payload, access.canPublish)
    return successResponse(item)
  })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ domain: string; id: string }> }) {
  return withConfigCenterAccess(req, 'write', async (_user, orgId) => {
    const { domain, id } = await params
    await deleteDomainItem(assertDomain(domain), orgId, id)
    return noContentResponse()
  })
}
