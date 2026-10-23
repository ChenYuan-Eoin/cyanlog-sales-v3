import { NextRequest } from 'next/server'
import type { AsyncRouteParams } from '@/lib/route-params'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import {
  canManagePlatformPermissionRegistry,
  PermissionRegistryError,
  restorePermissionDefinition,
} from '@/lib/permission-registry'

export async function POST(req: NextRequest, context: AsyncRouteParams) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await canManagePlatformPermissionRegistry(user.id, orgId)) {
      return errorResponse(createApiError('FORBIDDEN'))
    }
    const { id } = await context.params
    if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) return errorResponse(createApiError('VALIDATION_ERROR'))
    try {
      const definition = await restorePermissionDefinition(user.id, id)
      return successResponse({ definition })
    } catch (error) {
      if (error instanceof PermissionRegistryError) {
        if (error.code === 'NOT_FOUND') return errorResponse(createApiError('NOT_FOUND', error.message))
        if (error.code === 'CONFLICT') return errorResponse(createApiError('CONFLICT', error.message))
        return errorResponse(createApiError('VALIDATION_ERROR', error.message))
      }
      return errorResponse(createApiError('DB_ERROR', '权限定义恢复失败'))
    }
  })
}
