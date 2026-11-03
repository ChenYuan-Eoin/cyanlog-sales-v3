// REQ: F003 / WP50. Read the source ledger only; connection writes use the shared route.
// PURPOSE: View tenant sources while activation, unbinding and source cutover stay closed.

import { NextRequest } from 'next/server'
import { requireAuth, type AuthUser } from '@/lib/auth'
import { createApiError } from '@/lib/api/errors'
import { errorResponse, successResponse } from '@/lib/api/common'
import {
  canManageOrg,
  getFreshDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import {
  listOrganizationSourceProviders,
  loadOrganizationSources,
  OrganizationSourceError,
  sortActiveOrganizationSources,
} from '@/lib/organization-sources'
import { legacyFeishuMigrationAvailable } from '@/lib/organization-connections'

const DEFERRED_LIFECYCLE_MESSAGE = '当前版本只保存共享连接草稿并验证通讯录；启用、主来源切换、同步和停用将在目录差异确认批次开放。'

async function authorize(req: NextRequest, handler: (user: AuthUser, orgId: string) => Promise<Response>) {
  try {
    const user = await requireAuth(req)
    const requestedOrgId = req.headers.get('x-org-id')?.trim()
    const orgId = requestedOrgId || await getFreshDefaultOrgId(user.id)
    if (!orgId) return errorResponse(createApiError('NO_ORG'))
    const assignments = await getFreshUserScopedRoleAssignments(user.id)
    if (!canManageOrg(assignments, orgId)) return errorResponse(createApiError('FORBIDDEN'))
    return handler(user, orgId)
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    console.error('organization source authorization failed', error instanceof Error ? error.message : 'unknown error')
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}

function sourceError(error: unknown) {
  if (!(error instanceof OrganizationSourceError)) {
    console.error('organization source lifecycle failed', error instanceof Error ? error.message : 'unknown error')
    return errorResponse(createApiError('INTERNAL_ERROR', '组织来源操作失败。'))
  }
  if (error.status === 404) return errorResponse(createApiError('NOT_FOUND', error.message))
  if (error.status === 409) return errorResponse(createApiError('CONFLICT', error.message))
  if (error.status === 400) return errorResponse(createApiError('VALIDATION_ERROR', error.message))
  return errorResponse(createApiError('DB_ERROR', error.message))
}

export async function GET(req: NextRequest) {
  return authorize(req, async (_user, orgId) => {
    try {
      const sources = await loadOrganizationSources(orgId)
      const activePrimary = sortActiveOrganizationSources(sources).find((source) => source.priority === 1) || null
      const hasSharedFeishuConnection = sources.some(source => (
        source.provider === 'feishu' && source.connectionState !== 'unconfigured'
      ))
      return successResponse({
        sources,
        active_primary_source_id: activePrimary?.id || null,
        providers: listOrganizationSourceProviders(),
        legacy_feishu_binding: !activePrimary && !hasSharedFeishuConnection && legacyFeishuMigrationAvailable() && process.env.FEISHU_ORG_ID === orgId
          ? { provider: 'feishu', external_tenant_id: process.env.FEISHU_ORG_ID, migration_available: true }
          : null,
      })
    } catch (error) {
      return sourceError(error)
    }
  })
}

export async function POST(req: NextRequest) {
  return authorize(req, async () => errorResponse(createApiError('CONFLICT', DEFERRED_LIFECYCLE_MESSAGE)))
}

export async function DELETE(req: NextRequest) {
  return authorize(req, async () => errorResponse(createApiError('CONFLICT', DEFERRED_LIFECYCLE_MESSAGE)))
}
