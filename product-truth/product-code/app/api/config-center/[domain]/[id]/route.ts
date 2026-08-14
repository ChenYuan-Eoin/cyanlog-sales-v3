// REQ: F027-F036
// PURPOSE: 配置中心通用域 API（详情/更新/删除）——Next 14 同步 params
import { NextRequest } from 'next/server'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { errorResponse, successResponse, noContentResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { assertDomain, getDomainItem, updateDomainItem, deleteDomainItem, validateDomainPayload, ConfigCenterError } from '@/lib/config-center/server'

export async function GET(req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  return withAuthAndOrg(req, async (_user, orgId) => {
    try {
      const domain = assertDomain(params.domain)
      const item = await getDomainItem(domain, orgId, params.id)
      return successResponse(item)
    } catch (err) {
      if (err instanceof ConfigCenterError) {
        return errorResponse(createApiError('VALIDATION_ERROR', err.message))
      }
      return errorResponse(createApiError('DB_ERROR'))
    }
  })
}

export async function PUT(req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  return withAuthAndOrg(req, async (_user, orgId) => {
    try {
      const domain = assertDomain(params.domain)
      const body = await req.json()
      const payload = validateDomainPayload(domain, body)
      const item = await updateDomainItem(domain, orgId, params.id, payload)
      return successResponse(item)
    } catch (err) {
      if (err instanceof ConfigCenterError) {
        return errorResponse(createApiError('VALIDATION_ERROR', err.message))
      }
      return errorResponse(createApiError('DB_ERROR'))
    }
  })
}

export async function DELETE(req: NextRequest, { params }: { params: { domain: string; id: string } }) {
  return withAuthAndOrg(req, async (_user, orgId) => {
    try {
      const domain = assertDomain(params.domain)
      await deleteDomainItem(domain, orgId, params.id)
      return noContentResponse()
    } catch (err) {
      if (err instanceof ConfigCenterError) {
        return errorResponse(createApiError('VALIDATION_ERROR', err.message))
      }
      return errorResponse(createApiError('DB_ERROR'))
    }
  })
}
