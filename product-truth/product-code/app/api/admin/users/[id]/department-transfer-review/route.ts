import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { loadOrganizationPermissionAccess } from '@/lib/admin/member-actions'
import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

const guid = z.guid().transform(value => value.toLowerCase())
const reviewRequest = z.strictObject({ expected_org_id: guid, review_id: guid })
const reviewItem = z.object({
  review_id: z.guid(),
  effective_at: z.iso.datetime({ offset: true }),
  kind: z.enum(['role', 'retained_role', 'personal_override', 'pending_role', 'department_lead', 'space_membership']),
  permission_code: z.string().optional(),
  effect: z.enum(['ALLOW', 'DENY']).optional(),
  scope: z.record(z.string(), z.unknown()).optional(),
  role_id: z.guid().optional(),
  role_name: z.string().optional(),
  scope_type: z.enum(['org', 'department', 'space']).optional(),
  scope_id: z.guid().optional(),
  department_id: z.guid().optional(),
  department_name: z.string().optional(),
  space_id: z.guid().optional(),
  space_name: z.string().optional(),
})
const itemLimit = 200
type RouteContext = { params: Promise<{ id: string }> }

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

function forbidden() {
  return json({ error: '仅当前组织的系统超级管理员可以处理调部门复核。', code: 'DEPARTMENT_TRANSFER_REVIEW_FORBIDDEN' }, 403)
}

function failure(code?: string) {
  switch (code) {
    case 'DEPARTMENT_TRANSFER_FORBIDDEN':
    case 'DEPARTMENT_TRANSFER_REVIEW_FORBIDDEN':
      return forbidden()
    case 'DEPARTMENT_TRANSFER_REVIEW_NOT_FOUND':
      return json({ error: '当前组织中未找到该成员的复核事项。', code }, 404)
    case 'DEPARTMENT_TRANSFER_REVIEW_STALE':
      return json({ error: '该事项已被处理，请重新读取。', code }, 409)
    default:
      return json({ error: '暂时无法读取调部门复核结果，请稍后重试。', code: 'DEPARTMENT_TRANSFER_REVIEW_UNAVAILABLE' }, 503)
  }
}

async function handle(req: NextRequest, context: RouteContext, acknowledge: boolean) {
  try {
    const actor = await requireAuth(req)
    const access = await loadOrganizationPermissionAccess(actor.id)
    if (!access?.systemAdministrator) return forbidden()

    const userId = guid.safeParse((await context.params).id)
    let reviewId: string | undefined
    let requestedOrg: string | undefined
    if (acknowledge) {
      const origin = req.headers.get('origin')
      if (origin && origin !== req.nextUrl.origin) {
        return json({ error: '请求来源不受信任。', code: 'INVALID_ORIGIN' }, 403)
      }
      const body = reviewRequest.safeParse(await req.json().catch(() => null))
      if (body.success) {
        requestedOrg = body.data.expected_org_id
        reviewId = body.data.review_id
      }
    } else {
      const values = req.nextUrl.searchParams.getAll('expected_org_id')
      const org = guid.safeParse(values[0])
      if (values.length === 1 && org.success) requestedOrg = org.data
    }

    if (!requestedOrg || !userId.success) {
      return json({ error: '调部门复核参数不正确。', code: 'VALIDATION_ERROR' }, 400)
    }
    if (requestedOrg !== access.orgId) {
      return json({ error: '当前组织已变更，请重新打开成员名单。', code: 'ORGANIZATION_CHANGED' }, 409)
    }

    const scope = { p_org_id: access.orgId, p_actor_id: actor.id, p_user_id: userId.data }
    if (reviewId) {
      const { data, error } = await supabaseAdmin.rpc('acknowledge_member_department_transfer_review_v1', {
        ...scope, p_review_id: reviewId, p_request_id: req.headers.get('x-request-id')?.slice(0, 128) ?? null,
      })
      if (error) return failure(error.details)
      return data === true ? json({ success: true, review_id: reviewId }) : failure()
    }

    const { data, error } = await supabaseAdmin.rpc('list_member_department_transfer_reviews_v1', scope)
    if (error) return failure(error.details)
    const items = z.array(reviewItem).max(itemLimit + 1).safeParse(data)
    return items.success
      ? json({ items: items.data.slice(0, itemLimit), has_more: items.data.length > itemLimit })
      : failure()
  } catch (error) {
    if (error instanceof Error && (error.name === 'AuthError' || error.message === 'Unauthorized')) {
      return json({ error: '请重新登录。', code: 'UNAUTHORIZED' }, 401)
    }
    return failure()
  }
}

export async function GET(req: NextRequest, context: RouteContext) {
  return handle(req, context, false)
}

export async function POST(req: NextRequest, context: RouteContext) {
  return handle(req, context, true)
}
