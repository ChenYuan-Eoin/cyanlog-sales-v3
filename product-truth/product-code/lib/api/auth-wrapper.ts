// API 统一认证包装器
// 所有需要认证的 API 路由都应该使用这个包装器

import type { NextRequest } from 'next/server'
import { requireAuth, getAuthUser } from '@/lib/auth'
import { errorResponse } from './common'
import { createApiError } from './errors'
import type { AuthUser } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'

// 可选认证 - 不强制要求登录
export async function withOptionalAuth<T>(
  req: NextRequest,
  handler: (user: AuthUser | null) => Promise<T>
): Promise<T> {
  try {
    const user = await getAuthUser(req)
    return await handler(user)
  } catch {
    return await handler(null)
  }
}

// 强制认证 - 必须登录
export async function withAuth<T>(
  req: NextRequest,
  handler: (user: AuthUser) => Promise<T>
): Promise<T | Response> {
  try {
    const user = await requireAuth(req)
    return await handler(user)
  } catch (_error) {
    return errorResponse(createApiError('UNAUTHORIZED'))
  }
}

// 认证 + 组织检查
export async function withAuthAndOrg<T>(
  req: NextRequest,
  handler: (user: AuthUser, orgId: string) => Promise<T>
): Promise<T | Response> {
  try {
    const user = await requireAuth(req)

    const orgId = await getDefaultOrgId(user.id)
    if (!orgId) {
      return errorResponse(createApiError('NO_ORG'))
    }

    return await handler(user, orgId)
  } catch (_error) {
    if (_error instanceof Error && _error.name === 'AuthError') {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}

// 认证 + 权限检查
export async function withPermission<T>(
  req: NextRequest,
  permission: string,
  handler: (user: AuthUser) => Promise<T>
): Promise<T | Response> {
  try {
    const user = await requireAuth(req)

    // 这里可以扩展权限检查逻辑
    // 例如：检查 user.roles 是否包含所需权限

    return await handler(user)
  } catch (_error) {
    return errorResponse(createApiError('UNAUTHORIZED'))
  }
}
