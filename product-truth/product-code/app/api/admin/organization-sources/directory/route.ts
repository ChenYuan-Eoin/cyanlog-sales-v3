// REQ: F003 / WP92. Tenant-scoped immutable directory preview, apply and rollback.
import { NextRequest, NextResponse } from 'next/server'
import { loadOrganizationSourceAccess, type OrganizationSourceAccess } from '@/lib/admin/organization-source-access'
import {
  applyDirectoryCutoverPlan,
  loadLatestDirectoryCutoverPlan,
  prepareDirectoryCutoverPlan,
  rollbackDirectoryCutover,
} from '@/lib/organization-connections/directory-cutover'
import { isConfigurableProvider } from '@/lib/organization-connections/adapters'
import { OrganizationConnectionError } from '@/lib/organization-connections/errors'
import { detectDirectoryCutoverStorage } from '@/lib/organization-connections/storage'
import type { OrganizationConnectionProvider } from '@/lib/organization-connections/types'

export const runtime = 'nodejs'
export const maxDuration = 60

function directoryProvider(value: unknown): OrganizationConnectionProvider {
  if (!isConfigurableProvider(value)) {
    throw new OrganizationConnectionError('PROVIDER_NOT_SUPPORTED', '请选择已接入目录适配的提供方。', 400)
  }
  return value
}

function response(data: unknown, status = 200) {
  return NextResponse.json(
    status >= 400
      ? { error: data instanceof Error ? data.message : String(data) }
      : { data },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

async function authorize(
  req: NextRequest,
  run: (orgId: string, actorId: string, access: OrganizationSourceAccess) => Promise<Response>,
) {
  try {
    const context = await loadOrganizationSourceAccess(req)
    if (!context?.access.view) {
      return response(new OrganizationConnectionError('FORBIDDEN', '无权管理此企业的组织目录。', 403), 403)
    }
    return await run(context.orgId, context.actor.id, context.access)
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return response(new OrganizationConnectionError('UNAUTHORIZED', '请先登录。', 401), 401)
    }
    if (error instanceof OrganizationConnectionError) return response(error, error.status)
    console.error('organization directory cutover failed', error instanceof Error ? error.message : 'unknown error')
    return response(new OrganizationConnectionError('DIRECTORY_CUTOVER_UNAVAILABLE', '组织目录切源暂不可用，请稍后重试。', 503), 503)
  }
}

export async function GET(req: NextRequest) {
  return authorize(req, async (orgId, _actorId, access) => {
    const provider = directoryProvider(req.nextUrl.searchParams.get('provider'))
    if (!await detectDirectoryCutoverStorage()) {
      return response({
        plan: null,
        directory_cutover: {
          available: false,
          reason: '当前数据库尚未完成目录切源升级；目录读取可继续验收，差异应用与回滚暂不可用。',
        },
      })
    }
    return response({
      plan: access.preview || access.apply ? await loadLatestDirectoryCutoverPlan(orgId, provider) : null,
      directory_cutover: { available: true, reason: null },
    })
  })
}

export async function POST(req: NextRequest) {
  return authorize(req, async (orgId, actorId, access) => {
    const raw = await req.text()
    if (raw.length > 65_536) {
      throw new OrganizationConnectionError('INVALID_INPUT', '目录切源请求超出长度限制。', 400)
    }
    let body: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid')
      body = parsed as Record<string, unknown>
    } catch {
      throw new OrganizationConnectionError('INVALID_INPUT', '目录切源请求格式无效。', 400)
    }

    if (body.action === 'preview') {
      if (!access.preview) throw new OrganizationConnectionError('FORBIDDEN', '无权预览此组织的目录差异。', 403)
      const provider = directoryProvider(body.provider)
      return response({
        plan: await prepareDirectoryCutoverPlan({ orgId, actorId, provider }),
      })
    }

    if (body.action === 'apply') {
      if (!access.apply) throw new OrganizationConnectionError('FORBIDDEN', '无权应用此组织的目录差异。', 403)
      if (!Array.isArray(body.source_revisions)) {
        throw new OrganizationConnectionError('INVALID_INPUT', '来源版本快照缺失。', 400)
      }
      return response({
        run: await applyDirectoryCutoverPlan({
          orgId,
          actorId,
          planId: String(body.plan_id || ''),
          planHash: String(body.plan_hash || ''),
          connectionRevision: String(body.connection_revision || ''),
          sourceRevisions: body.source_revisions as Parameters<typeof applyDirectoryCutoverPlan>[0]['sourceRevisions'],
        }),
      })
    }

    if (body.action === 'rollback') {
      if (!access.apply) throw new OrganizationConnectionError('FORBIDDEN', '无权回滚此组织的目录同步。', 403)
      return response({
        run: await rollbackDirectoryCutover({
          orgId,
          actorId,
          planId: String(body.plan_id || ''),
        }),
      })
    }

    throw new OrganizationConnectionError('INVALID_ACTION', '请选择预览差异、确认切源或回滚。', 400)
  })
}
