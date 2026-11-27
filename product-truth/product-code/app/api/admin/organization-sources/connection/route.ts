// REQ: F003 / WP50. One authenticated API for every configurable provider.
import { NextRequest, NextResponse } from 'next/server'
import { loadOrganizationSourceAccess, type OrganizationSourceAccess } from '@/lib/admin/organization-source-access'
import {
  listOrganizationConnectionProviders,
  loadOrganizationConnection,
  OrganizationConnectionError,
  previewOrganizationConnection,
  saveOrganizationConnection,
  activateDirectoryConnection,
} from '@/lib/organization-connections'
import { detectConnectionStorageMode } from '@/lib/organization-connections/storage'
import { prepareFxiaokeCredentialRotation, promoteFxiaokeCredentialRotation, readFxiaokeCredentialRotation } from '@/lib/fxiaoke/credential-rotation'

export const runtime = 'nodejs'
export const maxDuration = 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function response(data: unknown, status = 200) {
  return NextResponse.json(
    status >= 400 ? { error: data instanceof Error ? data.message : String(data) } : { data },
    { status, headers: { 'Cache-Control': 'no-store' } },
  )
}

async function authorize(req: NextRequest, run: (orgId: string, actorId: string, access: OrganizationSourceAccess) => Promise<Response>) {
  try {
    const context = await loadOrganizationSourceAccess(req)
    if (!context?.access.view) {
      return response(new OrganizationConnectionError('FORBIDDEN', '无权管理此企业的组织接入。', 403), 403)
    }
    return await run(context.orgId, context.actor.id, context.access)
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') {
      return response(new OrganizationConnectionError('UNAUTHORIZED', '请先登录。', 401), 401)
    }
    if (error instanceof OrganizationConnectionError) return response(error, error.status)
    return response(new OrganizationConnectionError('CONNECTION_UNAVAILABLE', '组织接入暂不可用，请稍后重试。', 500), 500)
  }
}

export async function GET(req: NextRequest) {
  return authorize(req, async (orgId, actorId, access) => {
    const provider = req.nextUrl.searchParams.get('provider') || ''
    if (req.nextUrl.searchParams.get('view') === 'employee-verification' && provider === 'fxiaoke') {
      if (!access.enterpriseLogin || !access.apply) throw new OrganizationConnectionError('FORBIDDEN', '只有组织超管可以验证共享凭证。', 403)
      const sourceId = req.nextUrl.searchParams.get('sourceId')
      if (!sourceId || !UUID.test(sourceId)) throw new OrganizationConnectionError('INVALID_INPUT', '纷享来源无效。', 400)
      return response(await readFxiaokeCredentialRotation(orgId, actorId, sourceId))
    }
    const capability = listOrganizationConnectionProviders().find(item => item.key === provider)
    if (!capability?.configurable) {
      throw new OrganizationConnectionError('PROVIDER_NOT_CONFIGURABLE', '该组织提供方尚未接入连接配置。', 400)
    }
    const [connection, storageMode] = await Promise.all([
      loadOrganizationConnection(orgId, provider),
      detectConnectionStorageMode(),
    ])
    return response({
      provider: capability,
      storage_mode: storageMode,
      connection: connection && !access.connect ? { ...connection, metadata: {} } : connection,
    })
  })
}

export async function POST(req: NextRequest) {
  return authorize(req, async (orgId, actorId, access) => {
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
      if (!access.connect) throw new OrganizationConnectionError('FORBIDDEN', '无权保存此组织的外部连接。', 403)
      return response({ connection: await saveOrganizationConnection({ orgId, actorId, provider, value: body.configuration }) })
    }
    if (body.action === 'preview' && typeof body.revision === 'string' && UUID.test(body.revision)) {
      if (!access.connect) throw new OrganizationConnectionError('FORBIDDEN', '无权验证此组织的外部连接。', 403)
      const { connection, preview } = await previewOrganizationConnection({ orgId, actorId, provider, revision: body.revision })
      return response({ connection, preview: access.preview ? preview : null })
    }
    if (provider === 'fxiaoke' && (body.action === 'prepare_employee_verification' || body.action === 'activate_verified_credentials')) {
      const origin = req.headers.get('origin')
      if ((origin && origin !== req.nextUrl.origin) || !access.enterpriseLogin || !access.apply) {
        throw new OrganizationConnectionError('FORBIDDEN', '只有组织超管可以验证并启用纷享共享凭证。', 403)
      }
      if (typeof body.revision !== 'string' || !UUID.test(body.revision)) {
        throw new OrganizationConnectionError('INVALID_INPUT', '请重新读取当前配置。', 400)
      }
      if (body.action === 'prepare_employee_verification' && typeof body.memberId === 'string' && UUID.test(body.memberId)) {
        return response(await prepareFxiaokeCredentialRotation({ orgId, actorId, revision: body.revision, memberId: body.memberId }))
      }
      if (body.action === 'activate_verified_credentials' && typeof body.trialId === 'string' && UUID.test(body.trialId)) {
        await promoteFxiaokeCredentialRotation({ orgId, actorId, revision: body.revision, trialId: body.trialId })
        return response({ connection: await loadOrganizationConnection(orgId, provider) })
      }
      throw new OrganizationConnectionError('INVALID_INPUT', '请选择要验证的员工，或重新读取验证结果。', 400)
    }
    if (body.action === 'activate_directory' && typeof body.revision === 'string' && UUID.test(body.revision)) {
      if (!access.apply) throw new OrganizationConnectionError('FORBIDDEN', '无权启用此组织的目录连接。', 403)
      const connection = await activateDirectoryConnection({
        orgId, actorId, provider, configurationRevision: body.revision,
      })
      return response({ connection: access.connect ? connection : { ...connection, metadata: {} } })
    }
    throw new OrganizationConnectionError('INVALID_ACTION', '请选择保存配置、检查连接或启用目录连接。', 400)
  })
}
