// F003 / WP51. POST initiates an explicit external read; no organization business writes.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { loadOrganizationSourceAccess } from '@/lib/admin/organization-source-access'
import { inspectOrganizationDirectory, OrganizationConnectionError } from '@/lib/organization-connections'
import {
  checkFxiaokeDirectoryNow, readDirectoryCheckSchedule, setDirectoryCheckSchedule,
} from '@/lib/organization-connections/directory-check-schedule'

export const runtime = 'nodejs'
export const maxDuration = 60

const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
const requestSchema = z.object({ provider: z.string().min(1).max(40), sourceId: uuid, revision: uuid }).strict()
const checkSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('check'), sourceId: uuid }),
  z.strictObject({ action: z.literal('schedule'), sourceId: uuid, intervalDays: z.literal([0, 1, 3, 7]) }),
])

function respond(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

function inspectionFailure(error: unknown) {
  if (error instanceof Error && error.name === 'AuthError') return respond({ error: '请先登录。', code: 'UNAUTHORIZED' }, 401)
  if (error instanceof OrganizationConnectionError) return respond({ error: error.message, code: error.code }, error.status)
  return respond({ error: '目录核验未完成，请稍后重新读取；当前没有有效的新结果。', code: 'DIRECTORY_INSPECTION_FAILED' }, 502)
}

export async function GET(req: NextRequest) {
  try {
    const context = await loadOrganizationSourceAccess(req)
    if (!context?.access.preview) return respond({ error: '无权核验此企业的组织目录。', code: 'FORBIDDEN' }, 403)
    const source = uuid.safeParse(req.nextUrl.searchParams.get('sourceId'))
    if (!source.success) return respond({ error: '请读取当前纷享连接。', code: 'INVALID_INPUT' }, 400)
    const schedule = await readDirectoryCheckSchedule(context.orgId, source.data)
    if (!schedule) return respond({ error: '当前组织没有这条纷享连接。', code: 'SOURCE_NOT_FOUND' }, 404)
    return respond({ data: { schedule } })
  } catch (error) {
    return inspectionFailure(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const context = await loadOrganizationSourceAccess(req)
    if (!context?.access.preview) {
      return respond({ error: '无权核验此企业的组织目录。', code: 'FORBIDDEN' }, 403)
    }
    const raw = await req.text()
    if (raw.length > 2048) return respond({ error: '目录核验请求过长。', code: 'INVALID_INPUT' }, 400)
    let body: unknown
    try { body = JSON.parse(raw) } catch {
      return respond({ error: '目录核验请求格式无效。', code: 'INVALID_INPUT' }, 400)
    }
    const command = checkSchema.safeParse(body)
    if (command.success) {
      if (command.data.action === 'schedule' && !context.access.connect) {
        return respond({ error: '无权修改目录检查频率。', code: 'FORBIDDEN' }, 403)
      }
      const schedule = command.data.action === 'schedule'
        ? await setDirectoryCheckSchedule(context.orgId, command.data.sourceId, command.data.intervalDays)
        : await checkFxiaokeDirectoryNow(context.orgId, command.data.sourceId)
      if (!schedule) return respond({ error: '当前组织没有这条纷享连接。', code: 'SOURCE_NOT_FOUND' }, 404)
      return respond({ data: { schedule } })
    }
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success) return respond({ error: '请读取当前连接后重新核验。', code: 'INVALID_INPUT' }, 400)
    const report = await inspectOrganizationDirectory({ orgId: context.orgId, ...parsed.data })
    return respond({ data: { report } })
  } catch (error) {
    return inspectionFailure(error)
  }
}
