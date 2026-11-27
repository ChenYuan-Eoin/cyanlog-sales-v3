import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { evaluateDepartmentStructureAccess } from '@/lib/admin/department-actions'
import { loadOrganizationPermissionAccess } from '@/lib/admin/member-actions'
import { departmentOverrideChoice } from '@/lib/admin/member-department-save-contract'
import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

export const runtime = 'nodejs'
export const maxDuration = 60

const id = z.guid().transform(value => value.toLowerCase())
const distinctIds = z.array(id).max(1000).transform(values => [...new Set(values)])
const reviewFields = { choiceId: id.optional(), overrideChoice: departmentOverrideChoice.optional() }
const completeReview = (value: { choiceId?: string; overrideChoice?: string }) => Boolean(value.choiceId) === Boolean(value.overrideChoice)
const command = z.strictObject({
  transfers: z.array(z.strictObject({ userId: id, departmentId: id, ...reviewFields }).refine(completeReview)).max(1000).optional(),
  secondaryRemovals: z.array(z.strictObject({
    userId: id, departmentIds: distinctIds.refine(values => values.length > 0), ...reviewFields,
  }).refine(completeReview)).max(1000).optional(),
  suspendUserIds: distinctIds.optional(),
  offboardUserIds: distinctIds.optional(),
  reparent: z.array(z.strictObject({ departmentId: id, parentDepartmentId: id })).max(1000).optional(),
  archiveDepartmentIds: distinctIds.optional(),
})
const scope = { expectedOrgId: id }
const request = z.discriminatedUnion('action', [
  z.strictObject({
    ...scope, action: z.literal('preview'),
    departmentIds: distinctIds.refine(values => values.length > 0),
    includeChildren: z.boolean(), employmentFilter: z.enum(['active', 'all']),
    command: command.optional(),
  }),
  z.strictObject({ ...scope, action: z.literal('apply'), planId: id, planHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.strictObject({ ...scope, action: z.literal('restore'), departmentId: id, parentDepartmentId: id, archiveId: id }),
])

function reply(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function fail(status: number, code: string, error: string) {
  return reply({ code, error }, status)
}

function rpcFailure(error: { code?: string; details?: string } | null) {
  if (error?.code === '42501') return fail(403, 'NO_PERMISSION', '当前账号无权执行该部门操作。')
  if (error?.code === 'P0002') return fail(404, 'NOT_FOUND', '当前组织中没有可处理的记录，请刷新。')
  if (error?.code === '40001') return fail(409, 'DISPOSAL_STALE', '部门、成员或确认单已变化，请重新预览。')
  if (error?.code === '23505') return fail(409, 'DEPARTMENT_CONFLICT', '部门编码或处置记录冲突，请核对后重试。')
  if (error?.code === '22023' || error?.code === '22P02' || error?.code === '23514') {
    return fail(400, 'INVALID_DISPOSAL', '部门、人员或归档条件不符合要求，请核对处置预览。')
  }
  if (error?.code === 'PGRST202' || error?.code === '42883') {
    return fail(503, 'DISPOSAL_UPDATING', '部门处置服务正在更新，请稍后重试。')
  }
  console.error('Department disposal transaction failed', { code: error?.code })
  return fail(503, 'DISPOSAL_UNCONFIRMED', '暂时无法确认处置结果，请先重新读取部门状态。')
}

function routeFailure(error: unknown) {
  if (error instanceof Error && (error.name === 'AuthError' || error.message === 'Unauthorized')) {
    return fail(401, 'UNAUTHORIZED', '请重新登录。')
  }
  return rpcFailure(null)
}

export async function GET(req: NextRequest) {
  try {
    const actor = await requireAuth(req)
    const access = await loadOrganizationPermissionAccess(actor.id)
    if (!access || !evaluateDepartmentStructureAccess(access.decision).canRead) {
      return fail(403, 'NO_PERMISSION', '无权查看部门归档记录。')
    }
    const query = z.string().trim().max(100).safeParse(req.nextUrl.searchParams.get('query') ?? '')
    if (!query.success) return fail(400, 'VALIDATION_ERROR', '部门搜索条件不正确。')
    const { data, error } = await supabaseAdmin.rpc('list_manual_department_archives_v1', {
      p_org_id: access.orgId, p_actor_id: actor.id, p_query: query.data,
    })
    return error || !data ? rpcFailure(error) : reply({ data })
  } catch (error) {
    return routeFailure(error)
  }
}

export async function POST(req: NextRequest) {
  try {
    const origin = req.headers.get('origin')
    if (origin && origin !== req.nextUrl.origin) return fail(403, 'INVALID_ORIGIN', '请在当前站点操作。')
    const actor = await requireAuth(req)
    const raw = await req.text()
    if (raw.length > 256 * 1024) return fail(413, 'DISPOSAL_TOO_LARGE', '本次选择超出支持范围，请缩小范围。')
    let body: unknown
    try { body = JSON.parse(raw) } catch { return fail(400, 'VALIDATION_ERROR', '部门处置参数不正确。') }
    const parsed = request.safeParse(body)
    if (!parsed.success) return fail(400, 'VALIDATION_ERROR', '部门处置参数不正确。')

    const access = await loadOrganizationPermissionAccess(actor.id)
    if (!access || !evaluateDepartmentStructureAccess(access.decision).canRead || !access.systemAdministrator) {
      return fail(403, 'NO_PERMISSION', '仅当前组织有效的系统超级管理员可处置或恢复部门。')
    }
    const input = parsed.data
    if (input.expectedOrgId !== access.orgId) return fail(409, 'ORGANIZATION_CHANGED', '当前组织已变更，请刷新部门列表。')
    if (input.action !== 'restore' && !access.decision['user:view']) {
      return fail(403, 'NO_PERMISSION', '无权查看此组织的成员关系。')
    }

    const scope = { p_org_id: access.orgId, p_actor_id: actor.id }
    if (input.action === 'preview') {
      const { data, error } = await supabaseAdmin.rpc('preview_manual_department_disposal_v1', {
        ...scope, p_department_ids: input.departmentIds, p_include_children: input.includeChildren,
        p_employment_filter: input.employmentFilter, p_command: input.command ?? {},
      })
      return error || !data ? rpcFailure(error) : reply({ data })
    }
    if (input.action === 'restore') {
      const { data, error } = await supabaseAdmin.rpc('restore_manual_department_v1', {
        ...scope, p_department_id: input.departmentId, p_parent_department_id: input.parentDepartmentId, p_archive_id: input.archiveId,
      })
      return error || !data ? rpcFailure(error) : reply({ data })
    }
    const { data, error } = await supabaseAdmin.rpc('apply_manual_department_disposal_v1', {
      ...scope, p_plan_id: input.planId, p_plan_hash: input.planHash,
    })
    return error || !data ? rpcFailure(error) : reply({ data })
  } catch (error) {
    return routeFailure(error)
  }
}
