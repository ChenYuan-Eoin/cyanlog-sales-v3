// REQ: F003 组织来源绑定生命周期
// PURPOSE: 查看、绑定、换绑和停用租户外部组织来源

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
  bindOrganizationSource,
  listOrganizationSourceProviders,
  loadOrganizationSources,
  OrganizationSourceError,
  sortActiveOrganizationSources,
  unbindOrganizationSource,
  type OrganizationSourceStatus,
} from '@/lib/organization-sources'

const SOURCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export async function GET(req: NextRequest) {
  return authorize(req, async (_user, orgId) => {
    try {
      const sources = await loadOrganizationSources(orgId)
      const activePrimary = sortActiveOrganizationSources(sources).find((source) => source.priority === 1) || null
      return successResponse({
        sources,
        active_primary_source_id: activePrimary?.id || null,
        providers: listOrganizationSourceProviders(),
        legacy_feishu_binding: !activePrimary && process.env.FEISHU_ORG_ID === orgId
          ? { provider: 'feishu', external_tenant_id: process.env.FEISHU_ORG_ID, migration_available: true }
          : null,
      })
    } catch (error) {
      return sourceError(error)
    }
  })
}

export async function POST(req: NextRequest) {
  return authorize(req, async (user, orgId) => {
    let body: unknown
    try { body = await req.json() } catch { return errorResponse(createApiError('INVALID_JSON')) }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return errorResponse(createApiError('VALIDATION_ERROR'))
    const input = body as Record<string, unknown>
    const provider = stringValue(input.provider)
    const externalTenantId = stringValue(input.external_tenant_id)
    const priority = Number(input.priority)
    const status = stringValue(input.status) as OrganizationSourceStatus
    const syncMode = stringValue(input.sync_mode) as 'read_only' | 'authoritative' | 'enrichment'
    if (!['draft', 'active', 'disabled'].includes(status) || !['read_only', 'authoritative', 'enrichment'].includes(syncMode)) {
      return errorResponse(createApiError('VALIDATION_ERROR', '组织来源状态或同步模式无效。'))
    }
    const authorityScope = input.authority_scope && typeof input.authority_scope === 'object' && !Array.isArray(input.authority_scope)
      ? input.authority_scope as Record<string, unknown>
      : {}
    try {
      const source = await bindOrganizationSource({
        systemOrgId: orgId,
        provider,
        externalTenantId,
        priority,
        status,
        syncMode,
        authorityScope,
        actorId: user.id,
      })
      return successResponse({ source })
    } catch (error) {
      return sourceError(error)
    }
  })
}

export async function DELETE(req: NextRequest) {
  return authorize(req, async (user, orgId) => {
    let body: unknown
    try { body = await req.json() } catch { return errorResponse(createApiError('INVALID_JSON')) }
    const sourceId = body && typeof body === 'object' && !Array.isArray(body)
      ? stringValue((body as Record<string, unknown>).source_id)
      : ''
    if (!SOURCE_ID.test(sourceId)) return errorResponse(createApiError('VALIDATION_ERROR'))
    try {
      const source = await unbindOrganizationSource({ systemOrgId: orgId, sourceId, actorId: user.id })
      return successResponse({ source })
    } catch (error) {
      return sourceError(error)
    }
  })
}
