// REQ: F003 / WP50. Read the source ledger only; connection writes use the shared route.
// PURPOSE: View tenant sources while activation, unbinding and source cutover stay closed.

import { NextRequest } from 'next/server'
import { createApiError } from '@/lib/api/errors'
import { errorResponse, successResponse } from '@/lib/api/common'
import { loadOrganizationSourceAccess, type OrganizationSourceAccess } from '@/lib/admin/organization-source-access'
import {
  listOrganizationSourceProviders,
  loadOrganizationSources,
  OrganizationSourceError,
  sortActiveOrganizationSources,
} from '@/lib/organization-sources'

const DEFERRED_LIFECYCLE_MESSAGE = '当前版本只保存共享连接草稿并验证通讯录；启用、主来源切换、同步和停用将在目录差异确认批次开放。'

async function authorize(req: NextRequest, handler: (orgId: string, access: OrganizationSourceAccess) => Promise<Response>) {
  try {
    const context = await loadOrganizationSourceAccess(req)
    if (!context) return errorResponse(createApiError('NO_ORG'))
    if (!context.access.view) return errorResponse(createApiError('FORBIDDEN'))
    return await handler(context.orgId, context.access)
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
  return authorize(req, async (orgId, permissions) => {
    try {
      const sources = await loadOrganizationSources(orgId)
      const activePrimary = sortActiveOrganizationSources(sources).find((source) => source.priority === 1) || null
      return successResponse({
        sources,
        active_primary_source_id: activePrimary?.id || null,
        providers: listOrganizationSourceProviders(),
        permissions,
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
