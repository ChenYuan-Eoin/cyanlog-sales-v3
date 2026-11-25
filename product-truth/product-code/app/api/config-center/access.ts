import type { NextRequest } from 'next/server'
import { errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { requireAuth, type AuthUser } from '@/lib/auth'
import { ConfigCenterError } from '@/lib/config-center/server'
import { evaluateOrgConfigAccess, type OrgConfigAccess, type OrgConfigAccessDecision } from '@/lib/configs/access'
import { getFreshDefaultOrgId, getFreshUserScopedRoleAssignments } from '@/lib/scoped-access'

const accessProperty = {
  read: 'canRead',
  write: 'canWrite',
  publish: 'canPublish',
} as const

export async function withConfigCenterAccess(
  req: NextRequest,
  required: OrgConfigAccess,
  handler: (user: AuthUser, orgId: string, access: OrgConfigAccessDecision) => Promise<Response>,
): Promise<Response> {
  try {
    const user = await requireAuth(req)
    const [orgId, assignments] = await Promise.all([
      getFreshDefaultOrgId(user.id),
      getFreshUserScopedRoleAssignments(user.id),
    ])
    if (!orgId) return errorResponse(createApiError('NO_ORG'))

    const access = evaluateOrgConfigAccess(assignments, orgId)
    if (!access[accessProperty[required]]) return errorResponse(createApiError('FORBIDDEN'))

    return await handler(user, orgId, access)
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    if (error instanceof ConfigCenterError && error.code !== 'DB_ERROR') {
      const code = error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN' || error.code === 'CONFLICT'
        ? error.code
        : 'VALIDATION_ERROR'
      return errorResponse(createApiError(code, error.message))
    }
    return errorResponse(createApiError('DB_ERROR'))
  }
}
