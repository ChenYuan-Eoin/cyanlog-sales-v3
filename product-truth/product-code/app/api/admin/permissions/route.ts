import { NextRequest } from 'next/server'
import { withAuthAndOrg } from '@/lib/api/auth-wrapper'
import type { AuthUser } from '@/lib/auth'
import { createdResponse, errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import {
  canManagePlatformPermissionRegistry,
  createPermissionDefinition,
  listPermissionDefinitions,
  PermissionRegistryError,
} from '@/lib/permission-registry'

function registryError(error: unknown) {
  if (!(error instanceof PermissionRegistryError)) return null
  if (error.code === 'NOT_FOUND') return errorResponse(createApiError('NOT_FOUND', error.message))
  if (error.code === 'CONFLICT') return errorResponse(createApiError('CONFLICT', error.message))
  if (error.code === 'FORBIDDEN') return errorResponse(createApiError('FORBIDDEN', error.message))
  return errorResponse(createApiError('VALIDATION_ERROR', error.message))
}

export async function GET(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await canManagePlatformPermissionRegistry(user.id, orgId)) {
      return errorResponse(createApiError('FORBIDDEN'))
    }
    try {
      const result = await listPermissionDefinitions({ includeUnpublished: true, allowFallback: false })
      return successResponse({
        definitions: result.definitions,
        source: result.source,
      })
    } catch (error) {
      return registryError(error)
        || errorResponse(createApiError('DB_ERROR', '权限目录读取失败'))
    }
  })
}

export async function POST(req: NextRequest) {
  return withAuthAndOrg(req, async (user: AuthUser, orgId: string) => {
    if (!await canManagePlatformPermissionRegistry(user.id, orgId)) {
      return errorResponse(createApiError('FORBIDDEN'))
    }
    let body: unknown
    try {
      body = await req.json()
    } catch {
      return errorResponse(createApiError('INVALID_JSON'))
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return errorResponse(createApiError('VALIDATION_ERROR'))
    }
    try {
      const definition = await createPermissionDefinition(user.id, body as Record<string, unknown>)
      return createdResponse({ definition })
    } catch (error) {
      return registryError(error)
        || errorResponse(createApiError('DB_ERROR', '权限定义创建失败'))
    }
  })
}
