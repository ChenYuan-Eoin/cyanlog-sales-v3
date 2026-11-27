import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthError, requireAuth } from '@/lib/auth'
import { loadOrgRolePermissionContext } from '@/lib/org-role-permissions'
import type { AsyncRouteParams } from '@/lib/route-params'
import { supabaseAdmin } from '@/lib/supabase'

const guid = z.guid().transform(value => value.toLowerCase())
const rule = z.strictObject({ role_id: guid, include_subdepartments: z.boolean() })
const request = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('preview'), expected_org_id: guid, rules: z.array(rule).max(100) }),
  z.strictObject({ action: z.literal('confirm'), expected_org_id: guid, preview_id: guid }),
])
const state = z.object({
  org_id: z.guid(),
  department_id: z.guid(),
  rules: z.array(rule.extend({ role_name: z.string() })),
  available_roles: z.array(z.object({ role_id: z.guid(), role_name: z.string(), permissions: z.array(z.string()) })),
})
const preview = z.object({
  preview_id: z.guid(), expires_at: z.iso.datetime({ offset: true }),
  added_sources: z.number().int().nonnegative(),
  removed_sources: z.number().int().nonnegative(),
  affected_members: z.number().int().nonnegative(),
})

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

function failure(code?: string, detail?: string) {
  if (detail === 'ROLE_RULES_NO_CHANGE') return json({ error: '部门角色规则没有变化。', code: detail }, 409)
  switch (code) {
    case '42501': return json({ error: '仅当前组织的系统超级管理员可以管理部门角色规则。', code: 'NO_PERMISSION' }, 403)
    case 'P0002': return json({ error: '当前组织中没有该启用部门。' }, 404)
    case '22023': case '22P02': return json({ error: '部门角色规则参数无效。' }, 400)
    case '40001': return json({ error: '预览已失效或授权情况有变化，请重新预览。', code: 'ROLE_RULES_PREVIEW_STALE' }, 409)
    case '23514': return json({ error: '所选角色当前没有可用于部门的权限，请刷新后重选。' }, 409)
    default: return json({ error: '部门角色规则暂不可用，请刷新后核对。' }, 503)
  }
}

async function handle(req: NextRequest, { params }: AsyncRouteParams, write: boolean) {
  try {
    const origin = req.headers.get('origin')
    if (write && origin && origin !== req.nextUrl.origin) return json({ error: '请求来源不受信任。' }, 403)
    const actor = await requireAuth(req)
    const context = await loadOrgRolePermissionContext(actor.id)
    if (!context?.canEditPlatformRoot) return failure('42501')
    const departmentId = guid.safeParse((await params).id)
    const change = write ? request.safeParse(await req.json().catch(() => null)) : undefined
    const readOrg = req.nextUrl.searchParams.getAll('expected_org_id')
    const orgId = guid.safeParse(change ? change.data?.expected_org_id : readOrg.length === 1 ? readOrg[0] : null)
    if (!departmentId.success || !orgId.success || (change && !change.success)) return failure('22023')
    if (orgId.data !== context.orgId) return json({ error: '当前组织已变更，请重新打开部门。' }, 409)

    const args = { p_org_id: context.orgId, p_actor_id: actor.id, p_department_id: departmentId.data }
    const input = change?.data
    const { data, error } = input?.action === 'preview'
      ? await supabaseAdmin.rpc('admin_preview_department_role_rules_v1', { ...args, p_rules: input.rules })
      : input?.action === 'confirm'
        ? await supabaseAdmin.rpc('admin_confirm_department_role_rules_v1', { ...args, p_preview_id: input.preview_id })
        : await supabaseAdmin.rpc('admin_get_department_role_rules_v1', args)
    if (error) return failure(error.code, error.details)
    const result = (input?.action === 'preview' ? preview : state).safeParse(data)
    return result.success ? json(result.data) : failure()
  } catch (error) {
    if (error instanceof AuthError) return json({ error: '请先登录。' }, 401)
    return failure()
  }
}

export async function GET(req: NextRequest, context: AsyncRouteParams) {
  return handle(req, context, false)
}

export async function POST(req: NextRequest, context: AsyncRouteParams) {
  return handle(req, context, true)
}
