// F003 / WP51. POST initiates an explicit external read; no organization business writes.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { canManageOrg, getFreshDefaultOrgId, getFreshUserScopedRoleAssignments } from '@/lib/scoped-access'
import { inspectOrganizationDirectory, OrganizationConnectionError } from '@/lib/organization-connections'

export const runtime = 'nodejs'
export const maxDuration = 60

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const requestSchema = z.object({ provider: z.string().min(1).max(40), sourceId: uuid, revision: uuid }).strict()

function respond(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = req.headers.get('x-org-id')?.trim() || await getFreshDefaultOrgId(user.id)
    if (!orgId || !canManageOrg(await getFreshUserScopedRoleAssignments(user.id), orgId)) {
      return respond({ error: '无权核验此企业的组织目录。', code: 'FORBIDDEN' }, 403)
    }
    const raw = await req.text()
    if (raw.length > 2048) return respond({ error: '目录核验请求过长。', code: 'INVALID_INPUT' }, 400)
    let parsed: ReturnType<typeof requestSchema.safeParse>
    try { parsed = requestSchema.safeParse(JSON.parse(raw)) } catch {
      return respond({ error: '目录核验请求格式无效。', code: 'INVALID_INPUT' }, 400)
    }
    if (!parsed.success) return respond({ error: '请读取当前连接后重新核验。', code: 'INVALID_INPUT' }, 400)
    const report = await inspectOrganizationDirectory({ orgId, ...parsed.data })
    return respond({ data: { report } })
  } catch (error) {
    if (error instanceof Error && error.name === 'AuthError') return respond({ error: '请先登录。', code: 'UNAUTHORIZED' }, 401)
    if (error instanceof OrganizationConnectionError) return respond({ error: error.message, code: error.code }, error.status)
    return respond({ error: '目录核验未完成，请稍后重新读取；当前没有有效的新结果。', code: 'DIRECTORY_INSPECTION_FAILED' }, 502)
  }
}
