import { NextRequest, NextResponse } from 'next/server'
import { loadOrganizationSourceAccess } from '@/lib/admin/organization-source-access'
import { OrganizationConnectionError } from '@/lib/organization-connections/errors'
import { recordFxiaokeScopeProof } from '@/lib/organization-connections/fxiaoke-directory-scope'

export const runtime = 'nodejs'
export const maxDuration = 60

const MAX_MANIFEST_BYTES = 2 * 1024 * 1024

function respond(body: Record<string, unknown>, status: number) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: NextRequest) {
  try {
    const origin = request.headers.get('origin')
    if (origin && origin !== request.nextUrl.origin) return respond({ error: '请求来源无效。' }, 403)
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return respond({ error: '目录核对清单必须使用 JSON。' }, 415)
    }
    const context = await loadOrganizationSourceAccess(request)
    if (!context?.access.enterpriseLogin) return respond({ error: '只有当前组织的超级管理员可以提交纷享目录范围证据。' }, 403)
    if (Number(request.headers.get('content-length')) > MAX_MANIFEST_BYTES) return respond({ error: '目录核对清单过大。' }, 413)

    const raw = await request.text()
    if (Buffer.byteLength(raw) > MAX_MANIFEST_BYTES) return respond({ error: '目录核对清单过大。' }, 413)
    let manifest: unknown
    try { manifest = JSON.parse(raw) } catch { return respond({ error: '目录核对清单格式无效。' }, 400) }
    const proof = await recordFxiaokeScopeProof(context.orgId, context.actor.id, manifest)
    return respond({ data: { proof } }, 201)
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') return respond({ error: '请先登录。', code: 'UNAUTHORIZED' }, 401)
    if (error instanceof OrganizationConnectionError) return respond({ error: error.message, code: error.code }, error.status)
    return respond({ error: '无法核对纷享目录范围，请稍后重试。', code: 'DIRECTORY_SCOPE_PROOF_UNAVAILABLE' }, 503)
  }
}
