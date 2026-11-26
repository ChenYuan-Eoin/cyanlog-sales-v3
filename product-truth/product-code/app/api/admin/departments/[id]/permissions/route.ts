import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { AuthError, requireAuth } from '@/lib/auth'
import { loadOrgRolePermissionContext } from '@/lib/org-role-permissions'
import { loadRoleModulePermissionProjection } from '@/lib/permission-registry'
import type { AsyncRouteParams } from '@/lib/route-params'
import { supabaseAdmin } from '@/lib/supabase'

const ledgerView = 'shipping:ledger_view'
const idSchema = z.guid().transform(id => id.toLowerCase())
const permissionsSchema = z.array(z.literal(ledgerView)).max(1)
const changeSchema = z.strictObject({
  expected_org_id: idSchema,
  expected_permissions: permissionsSchema,
  expected_include_subdepartments: z.boolean(),
  permissions: permissionsSchema,
  include_subdepartments: z.boolean(),
}).refine(change => (!change.expected_include_subdepartments || change.expected_permissions.length > 0)
  && (!change.include_subdepartments || change.permissions.length > 0))
const stateSchema = z.object({
  permissions: permissionsSchema,
  include_subdepartments: z.boolean(),
})

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

function failure(code?: string) {
  switch (code) {
    case '42501': return json({ error: '仅系统超级管理员可以管理部门权限。' }, 403)
    case 'P0002': return json({ error: '启用的部门不存在。' }, 404)
    case '40001': return json({ error: '当前组织或部门权限已变更，请刷新后重试。' }, 409)
    case '23514': return json({ error: '所选权限当前未发布为部门权限，请刷新后重试。' }, 409)
    case '22023': return json({ error: '部门权限数据无效。' }, 400)
    default: return json({ error: '部门权限暂不可用，请稍后重试。' }, 503)
  }
}

async function handle(req: NextRequest, { params }: AsyncRouteParams, write: boolean) {
  try {
    const actor = await requireAuth(req)
    const context = await loadOrgRolePermissionContext(actor.id)
    if (!context?.canEditPlatformRoot) return failure('42501')
    const departmentId = idSchema.safeParse((await params).id)
    if (!departmentId.success) return json({ error: '部门 ID 格式不正确。' }, 400)
    const args = {
      p_actor_id: actor.id,
      p_org_id: context.orgId,
      p_department_id: departmentId.data,
    }
    let change: z.infer<typeof changeSchema> | undefined
    if (write) {
      const origin = req.headers.get('origin')
      if (origin && origin !== req.nextUrl.origin) return json({ error: '请求来源不受信任。' }, 403)
      const parsed = changeSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return failure('22023')
      if (parsed.data.expected_org_id !== context.orgId) return failure('40001')
      change = parsed.data
    }
    const { catalog, publication: { departmentLedgerPublished } } = await loadRoleModulePermissionProjection()
    if (change?.permissions.length && !departmentLedgerPublished) return failure('23514')
    const { data, error } = change
      ? await supabaseAdmin.rpc('admin_set_department_permissions_v1', {
        ...args,
        p_expected_org_id: change.expected_org_id,
        p_expected_permissions: change.expected_permissions,
        p_expected_include_subdepartments: change.expected_include_subdepartments,
        p_permissions: change.permissions,
        p_include_subdepartments: change.include_subdepartments,
      })
      : await supabaseAdmin.rpc('admin_get_department_permissions_v1', args)
    if (error) return failure(error.code)
    const state = stateSchema.safeParse(data)
    if (!state.success) return failure()

    return json({
      org_id: context.orgId,
      department_id: departmentId.data,
      ...state.data,
      available_permissions: departmentLedgerPublished ? [ledgerView] : [],
      permission_catalog: catalog,
      permissions_editable: true,
    })
  } catch (error) {
    if (error instanceof AuthError) return json({ error: '请先登录。' }, 401)
    return failure()
  }
}

export async function GET(req: NextRequest, context: AsyncRouteParams) {
  return handle(req, context, false)
}

export async function PATCH(req: NextRequest, context: AsyncRouteParams) {
  return handle(req, context, true)
}
