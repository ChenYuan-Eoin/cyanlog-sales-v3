import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthError, requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

const idSchema = z.guid()
const changeSchema = z.strictObject({
  departmentId: idSchema,
  userId: idSchema.nullable(),
  expectedUserId: idSchema.nullable(),
})
const lookupSchema = z.object({ leaderId: idSchema.nullable(), userId: idSchema.nullable() })
const resultSchema = z.object({ status: z.enum(['saved', 'unchanged']), userId: idSchema.nullable() })

function json(payload: object, status = 200) {
  return NextResponse.json(payload, { status, headers: { 'Cache-Control': 'no-store' } })
}

function failure(error: string, code: string, status: number) {
  return json({ error, code }, status)
}

async function resolveActor(req: NextRequest) {
  const actor = await requireAuth(req)
  const { data, error } = await supabaseAdmin
    .from('user_organizations')
    .select('org_id')
    .eq('user_id', actor.id)
    .eq('is_default', true)
    .eq('status', 'active')
    .eq('employment_status', 'active')
    .is('left_at', null)
    .maybeSingle()
  if (error) throw error
  return data ? { p_actor_id: actor.id, p_org_id: data.org_id } : null
}

function rpcFailure(code?: string) {
  switch (code) {
    case '42501':
      return failure('当前账号无权管理部门负责人授权', 'NO_PERMISSION', 403)
    case 'P0002':
      return failure('启用的部门不存在', 'DEPARTMENT_NOT_FOUND', 404)
    case '40001':
      return failure('授权已变更，请刷新后重试', 'DEPARTMENT_LEAD_ACCESS_CHANGED', 409)
    case '23514':
      return failure('只能为当前在职的部门负责人确认授权', 'DEPARTMENT_LEADER_NOT_ELIGIBLE', 409)
    case 'PGRST202':
    case '42883':
      return failure('部门负责人授权服务正在更新，请稍后重试', 'DEPARTMENT_LEAD_ACCESS_UNAVAILABLE', 503)
    default:
      return failure('暂无法处理部门负责人授权', 'DEPARTMENT_LEAD_ACCESS_FAILED', 500)
  }
}

function requestFailure(error: unknown) {
  if (error instanceof AuthError) return failure('请先登录', 'UNAUTHORIZED', 401)
  return rpcFailure()
}

export async function GET(req: NextRequest) {
  try {
    const actor = await resolveActor(req)
    if (!actor) return rpcFailure('42501')
    const departmentId = idSchema.safeParse(req.nextUrl.searchParams.get('departmentId'))
    if (!departmentId.success) return failure('部门 ID 格式不正确', 'VALIDATION_ERROR', 400)
    const { data, error } = await supabaseAdmin.rpc('admin_get_department_lead_access_v1', {
      ...actor,
      p_department_id: departmentId.data,
    })
    if (error) return rpcFailure(error.code)
    const result = lookupSchema.safeParse(data)
    return result.success ? json({ success: true, ...result.data }) : rpcFailure()
  } catch (error) {
    return requestFailure(error)
  }
}

export async function PUT(req: NextRequest) {
  try {
    const actor = await resolveActor(req)
    if (!actor) return rpcFailure('42501')
    const change = changeSchema.safeParse(await req.json().catch(() => null))
    if (!change.success) return failure('请提供部门、当前授权和目标成员', 'VALIDATION_ERROR', 400)
    const { data, error } = await supabaseAdmin.rpc('admin_set_department_lead_access_v1', {
      ...actor,
      p_department_id: change.data.departmentId,
      p_user_id: change.data.userId,
      p_expected_user_id: change.data.expectedUserId,
      p_request_id: req.headers.get('x-request-id')?.slice(0, 128) ?? null,
    })
    if (error) return rpcFailure(error.code)
    const result = resultSchema.safeParse(data)
    return result.success ? json({ success: true, ...result.data }) : rpcFailure()
  } catch (error) {
    return requestFailure(error)
  }
}
