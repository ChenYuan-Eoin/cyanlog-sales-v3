// API 统一认证包装器
// 所有需要认证的 API 路由都应该使用这个包装器

import type { NextRequest } from 'next/server'
import { AuthDependencyError, AuthError, requireAuth, getAuthUser } from '@/lib/auth'
import { errorResponse } from './common'
import { createApiError } from './errors'
import type { AuthUser } from '@/lib/auth'

const AUTH_ORG_QUERY_TIMEOUT_MS = 8_000

function authDependencyResponse() {
  return errorResponse(
    createApiError('SERVICE_UNAVAILABLE', '身份服务暂时不可用，请重试')
  )
}

export function authenticationErrorResponse(error: unknown): Response | null {
  if (error instanceof AuthDependencyError || (
    error instanceof Error && error.name === 'AuthDependencyError'
  )) {
    return authDependencyResponse()
  }

  if (error instanceof AuthError || (
    error instanceof Error && error.name === 'AuthError'
  )) {
    return errorResponse(createApiError('UNAUTHORIZED'))
  }

  // 配置、编程和业务异常不是身份失败；交给路由/Next.js 按 500 处理。
  return null
}

function authenticationFailureResponse(error: unknown): Response {
  const response = authenticationErrorResponse(error)
  if (response) return response
  throw error
}

async function getDefaultOrgId(userId: string): Promise<string | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), AUTH_ORG_QUERY_TIMEOUT_MS)

  try {
    const { supabaseAdmin } = await import('@/lib/supabase')
    const { data: userOrg, error } = await supabaseAdmin
      .from('user_organizations')
      .select('org_id')
      .eq('user_id', userId)
      .eq('is_default', true)
      .abortSignal(controller.signal)
      .maybeSingle()

    if (error) {
      throw new AuthDependencyError('Authentication organization lookup failed')
    }

    return userOrg?.org_id ?? null
  } catch (error) {
    if (error instanceof AuthDependencyError) throw error
    throw new AuthDependencyError()
  } finally {
    clearTimeout(timeout)
  }
}

// 可选认证 - 不强制要求登录
export async function withOptionalAuth<T>(
  req: NextRequest,
  handler: (user: AuthUser | null) => Promise<T>
): Promise<T | Response> {
  let user: AuthUser | null
  try {
    user = await getAuthUser(req)
  } catch (error) {
    if (error instanceof AuthDependencyError || (
      error instanceof Error && error.name === 'AuthDependencyError'
    )) {
      return authDependencyResponse()
    }
    throw error
  }

  // handler 必须位于认证 catch 之外，避免业务异常后二次以匿名身份执行。
  return await handler(user)
}

// 强制认证 - 必须登录
export async function withAuth<T>(
  req: NextRequest,
  handler: (user: AuthUser) => Promise<T>
): Promise<T | Response> {
  let user: AuthUser
  try {
    user = await requireAuth(req)
  } catch (error) {
    return authenticationFailureResponse(error)
  }

  return await handler(user)
}

// 认证 + 组织检查
export async function withAuthAndOrg<T>(
  req: NextRequest,
  handler: (user: AuthUser, orgId: string) => Promise<T>
): Promise<T | Response> {
  let user: AuthUser
  let orgId: string | null
  try {
    user = await requireAuth(req)
    orgId = await getDefaultOrgId(user.id)
  } catch (error) {
    return authenticationFailureResponse(error)
  }

  if (!orgId) {
    return errorResponse(createApiError('NO_ORG'))
  }

  return await handler(user, orgId)
}

// 认证 + 权限检查
export async function withPermission<T>(
  req: NextRequest,
  permission: string,
  handler: (user: AuthUser) => Promise<T>
): Promise<T | Response> {
  let user: AuthUser
  try {
    user = await requireAuth(req)
  } catch (error) {
    return authenticationFailureResponse(error)
  }

  // 这里可以扩展权限检查逻辑，例如检查 user.roles 是否包含所需权限。
  return await handler(user)
}
