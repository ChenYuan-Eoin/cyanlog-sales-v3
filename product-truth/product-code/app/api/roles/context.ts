import type { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { loadOrgRolePermissionContext } from '@/lib/org-role-permissions'

export async function withRolePermissionContext(
  req: NextRequest,
  handler: (context: NonNullable<Awaited<ReturnType<typeof loadOrgRolePermissionContext>>>) => Promise<Response>,
): Promise<Response> {
  try {
    const user = await requireAuth(req)
    const context = await loadOrgRolePermissionContext(user.id)
    if (!context) return errorResponse(createApiError('FORBIDDEN', '没有有效的组织成员资格'))
    return await handler(context)
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}

export function isRoleId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(value)
}
