// REQ: F003 / WP50. One authenticated API for every configurable provider.
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import {
  canManageOrg,
  getFreshDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import {
  listOrganizationConnectionProviders,
  loadOrganizationConnection,
  OrganizationConnectionError,
  previewOrganizationConnection,
  saveOrganizationConnection,
} from '@/lib/organization-connections'
import { detectConnectionStorageMode } from '@/lib/organization-connections/storage'

export const runtime = 'nodejs'
export const maxDuration = 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function response(data: unknown, status = 200) {
  return NextResponse.json(
    status >= 400 ? { error: data instanceof Error ? data.message : String(data) } : { data },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

async function authorize(req: NextRequest, run: (orgId: string, actorId: string) => Promise<Response>) {
  try {
    const user = await requireAuth(req)
    const orgId = req.headers.get('x-org-id')?.trim() || await getFreshDefaultOrgId(user.id)
    if (!orgId || !canManageOrg(await getFreshUserScopedRoleAssignments(user.id), orgId)) {
      return response(new OrganizationConnectionError('FORBIDDEN', '无权管理此企业的组织接入。', 403), 403)
    }
    return await run(orgId, user.id)
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return response(new OrganizationConnectionError('UNAUTHORIZED', '请先登录。', 401), 401)
    }
    if (error instanceof OrganizationConnectionError) return response(error, error.status)
    return response(new OrganizationConnectionError('CONNECTION_UNAVAILABLE', '组织接入暂不可用，请稍后重试。', 500), 500)
  }
}

export async function GET(req: NextRequest) {
  return authorize(req, async orgId => {
    const provider = req.nextUrl.searchParams.get('provider') || ''
    const capability = listOrganizationConnectionProviders().find(item => item.key === provider)
    if (!capability?.configurable) {
      throw new OrganizationConnectionError('PROVIDER_NOT_CONFIGURABLE', '该组织提供方尚未接入连接配置。', 400)
    }
    return response({
      provider: capability,
      storage_mode: await detectConnectionStorageMode(),
      connection: await loadOrganizationConnection(orgId, provider),
    })
  })
}

export async function POST(req: NextRequest) {
  return authorize(req, async (orgId, actorId) => {
    const raw = await req.text()
    if (raw.length > 16_384) throw new OrganizationConnectionError('INVALID_INPUT', '配置内容超出长度限制。', 400)
    let body: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
      body = parsed as Record<string, unknown>
    } catch {
      throw new OrganizationConnectionError('INVALID_INPUT', '请求格式无效。', 400)
    }

    const provider = typeof body.provider === 'string' ? body.provider : ''
    if (body.action === 'save') {
      return response({ connection: await saveOrganizationConnection({ orgId, actorId, provider, value: body.configuration }) })
    }
    if (body.action === 'preview' && typeof body.revision === 'string' && UUID.test(body.revision)) {
      return response(await previewOrganizationConnection({ orgId, actorId, provider, revision: body.revision }))
    }
    throw new OrganizationConnectionError('INVALID_ACTION', '请选择保存配置或验证通讯录。', 400)
  })
}
