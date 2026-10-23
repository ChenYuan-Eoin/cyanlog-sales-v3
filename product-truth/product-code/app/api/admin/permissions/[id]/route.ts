import { NextRequest } from 'next/server'
import type { AsyncRouteParams } from '@/lib/route-params'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import {
  canManagePlatformPermissionRegistry,
  loadPermissionDefinition,
  PermissionRegistryError,
  softDeletePermissionDefinition,
  transitionPermissionDefinition,
  updatePermissionDefinition,
} from '@/lib/permission-registry'

function registryError(error: unknown) {
  if (!(error instanceof PermissionRegistryError)) return null
  if (error.code === 'NOT_FOUND') return errorResponse(createApiError('NOT_FOUND', error.message))
  if (error.code === 'CONFLICT') return errorResponse(createApiError('CONFLICT', error.message))
  if (error.code === 'FORBIDDEN') return errorResponse(createApiError('FORBIDDEN', error.message))
  return errorResponse(createApiError('VALIDATION_ERROR', error.message))
}

function validId(id: string) {
  return /^[a-zA-Z0-9-]{1,80}$/.test(id)
}

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export async function GET(req: NextRequest, context: AsyncRouteParams) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await canManagePlatformPermissionRegistry(user.id, orgId)) {
      return errorResponse(createApiError('FORBIDDEN'))
    }
    const { id } = await context.params
    if (!validId(id)) return errorResponse(createApiError('VALIDATION_ERROR'))
    try {
      return successResponse({ definition: await loadPermissionDefinition(id) })
    } catch (error) {
      return registryError(error)
        || errorResponse(createApiError('DB_ERROR', '权限定义读取失败'))
    }
  })
}

export async function PATCH(req: NextRequest, context: AsyncRouteParams) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await canManagePlatformPermissionRegistry(user.id, orgId)) {
      return errorResponse(createApiError('FORBIDDEN'))
    }
    const { id } = await context.params
    if (!validId(id)) return errorResponse(createApiError('VALIDATION_ERROR'))
    const body = await readBody(req)
    if (!body) return errorResponse(createApiError('VALIDATION_ERROR'))
    try {
      if (typeof body.action === 'string') {
        if (!['review', 'publish', 'deprecate', 'disable'].includes(body.action)) {
          return errorResponse(createApiError('VALIDATION_ERROR', '未知权限生命周期动作。'))
        }
        const definition = await transitionPermissionDefinition(
          user.id,
          id,
          body.action as 'review' | 'publish' | 'deprecate' | 'disable',
          typeof body.reason === 'string' ? body.reason : undefined,
        )
        return successResponse({ definition })
      }
      const definition = await updatePermissionDefinition(user.id, id, body)
      return successResponse({ definition })
    } catch (error) {
      return registryError(error)
        || errorResponse(createApiError('DB_ERROR', '权限定义更新失败'))
    }
  })
}

export async function DELETE(req: NextRequest, context: AsyncRouteParams) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await canManagePlatformPermissionRegistry(user.id, orgId)) {
      return errorResponse(createApiError('FORBIDDEN'))
    }
    const { id } = await context.params
    if (!validId(id)) return errorResponse(createApiError('VALIDATION_ERROR'))
    const body = await readBody(req)
    try {
      const definition = await softDeletePermissionDefinition(
        user.id,
        id,
        typeof body?.reason === 'string' ? body.reason : undefined,
      )
      return successResponse({ definition })
    } catch (error) {
      return registryError(error)
        || errorResponse(createApiError('DB_ERROR', '权限定义删除失败'))
    }
  })
}
