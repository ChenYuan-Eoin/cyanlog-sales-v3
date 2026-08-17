// REQ: F037-F046
// PURPOSE: 配置中心通用域 API（列表/创建）——签名与仓库 Next 15 环境一致（async params）
import { NextRequest } from 'next/server'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import { errorResponse, paginatedResponse, createdResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { assertDomain, listDomain, createDomainItem, validateDomainPayload, ConfigCenterError } from '@/lib/config-center/server'

export async function GET(req: NextRequest, { params }: { params: Promise<{ domain: string }> }) {
  return withAuthAndOrg(req, async (_user, orgId) => {
    try {
      const domain = assertDomain((await params).domain)
      const { searchParams } = new URL(req.url)
      const status = searchParams.get('status') || undefined
      const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 100)
      const offset = parseInt(searchParams.get('offset') || '0', 10)
      const { data, count } = await listDomain(domain, orgId, status, limit, offset)
      return paginatedResponse(data, count, limit, offset)
    } catch (err) {
      if (err instanceof ConfigCenterError) {
        return errorResponse(createApiError('VALIDATION_ERROR', err.message))
      }
      return errorResponse(createApiError('DB_ERROR'))
    }
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ domain: string }> }) {
  return withAuthAndOrg(req, async (user, orgId) => {
    try {
      const domain = assertDomain((await params).domain)
      const body = await req.json()
      const payload = validateDomainPayload(domain, body)
      const item = await createDomainItem(domain, orgId, user.id, payload)
      return createdResponse(item)
    } catch (err) {
      if (err instanceof ConfigCenterError) {
        return errorResponse(createApiError('VALIDATION_ERROR', err.message))
      }
      return errorResponse(createApiError('DB_ERROR'))
    }
  })
}
