import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { isOrganizationEmployeePermissionKey, organizationEmployeePermissionKeys } from '@/lib/admin/employee-organization-permissions'
import { AuthError, requireAuth } from '@/lib/auth'
import { loadOrgRolePermissionContext } from '@/lib/org-role-permissions'
import type { AsyncRouteParams } from '@/lib/route-params'
import { employeePermissionAllowsScope, employeeShippingPermissionKeys } from '@/lib/shipping/employee-permission-scope'
import { loadEmployeePermissionTable } from '@/lib/shipping/entry-access'
import { supabaseAdmin } from '@/lib/supabase'

const idSchema = z.guid().transform(id => id.toLowerCase())
const permissionCodeSchema = z.enum([...employeeShippingPermissionKeys, ...organizationEmployeePermissionKeys])
const departmentSelectorsSchema = z.array(z.strictObject({
  department_id: idSchema,
  include_subdepartments: z.boolean(),
})).min(1)
  .refine(selectors => new Set(selectors.map(selector => selector.department_id)).size === selectors.length)
  .transform(selectors => selectors.sort((left, right) => left.department_id.localeCompare(right.department_id)))
const scopeSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('self') }),
  z.strictObject({ type: z.literal('org') }),
  z.strictObject({ type: z.literal('department'), departments: departmentSelectorsSchema }),
])
const overrideSchema = z.discriminatedUnion('effect', [
  z.strictObject({ effect: z.literal('DENY'), scope: z.null() }),
  z.strictObject({ effect: z.literal('ALLOW'), scope: scopeSchema }),
]).nullable()

type PermissionCode = z.infer<typeof permissionCodeSchema>
type Override = z.infer<typeof overrideSchema>

function supportsScope(key: PermissionCode, override: Override): boolean {
  return override?.effect !== 'ALLOW' || (isOrganizationEmployeePermissionKey(key)
    ? override.scope.type === 'org' : employeePermissionAllowsScope(key, override.scope.type))
}

const patchSchema = z.strictObject({
  permission_code: permissionCodeSchema,
  expected_override: overrideSchema,
  override: overrideSchema,
  target_revision: z.string().min(1).max(128).optional(),
}).refine(input => supportsScope(input.permission_code, input.expected_override)
  && supportsScope(input.permission_code, input.override))

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

function failure(code?: string, detail?: string) {
  switch (code) {
    case '42501':
      return detail === 'EMPLOYEE_PERMISSION_OVERRIDE_PROTECTED'
        ? json({ error: '此成员的系统超级管理员权限受保护。', code: detail }, 403)
        : json({ error: '仅系统超级管理员可以管理员工个人权限。', code: 'NO_PERMISSION' }, 403)
    case 'P0002':
      return json({ error: '当前组织中找不到该在职成员。', code: 'EMPLOYEE_PERMISSION_OVERRIDE_TARGET_NOT_FOUND' }, 404)
    case '40001':
      return json({ error: '当前组织或个人权限已变更，请刷新后重试。', code: 'EMPLOYEE_PERMISSION_OVERRIDE_CONFLICT' }, 409)
    case '23514':
      return json({ error: '所选权限点当前不可分配，请刷新后重试。', code: 'EMPLOYEE_PERMISSION_OVERRIDE_NOT_PUBLISHED' }, 409)
    case '22023':
      return json({ error: '个人权限或数据范围格式无效。', code: 'EMPLOYEE_PERMISSION_OVERRIDE_INVALID' }, 400)
    default:
      return json({ error: '员工个人权限暂不可用，请稍后重试。', code: 'EMPLOYEE_PERMISSION_OVERRIDE_UNAVAILABLE' }, 503)
  }
}

function matchesOverride(value: unknown, expected: Override) {
  const parsed = overrideSchema.safeParse(value)
  return parsed.success && JSON.stringify(parsed.data) === JSON.stringify(expected)
}

async function handle(req: NextRequest, { params }: AsyncRouteParams, write: boolean) {
  try {
    const actor = await requireAuth(req)
    const authority = await loadOrgRolePermissionContext(actor.id)
    if (!authority?.canEditPlatformRoot) return failure('42501')

    const requestedOrgs = req.nextUrl.searchParams.getAll('orgId')
    const orgId = idSchema.safeParse(requestedOrgs[0])
    const userId = idSchema.safeParse((await params).id)
    if (requestedOrgs.length !== 1 || !orgId.success || !userId.success) return failure('22023')
    if (orgId.data !== authority.orgId.toLowerCase()) return failure('40001')

    let change: z.infer<typeof patchSchema> | undefined
    if (write) {
      const origin = req.headers.get('origin')
      if (origin && origin !== req.nextUrl.origin) {
        return json({ error: '请求来源不受信任。', code: 'INVALID_ORIGIN' }, 403)
      }
      const parsed = patchSchema.safeParse(await req.json().catch(() => null))
      if (!parsed.success) return failure('22023')
      change = parsed.data
    }

    const snapshot = await loadEmployeePermissionTable(userId.data, orgId.data, actor.id)
    if (!snapshot) return failure(change?.target_revision === undefined ? 'P0002' : '40001')
    if (!change) return json({ org_id: orgId.data, user_id: userId.data, ...snapshot })
    if (change.target_revision !== snapshot.target_revision) return failure('40001')

    const point = snapshot.permissions.find(permission => permission.key === change.permission_code)
    if (!point) return failure('23514')
    const organizationAction = isOrganizationEmployeePermissionKey(change.permission_code)
    const published = organizationAction
      ? snapshot.organization_permission_publication
      : snapshot.shipping_permission_publication.published
    if (change.override !== null && !published.includes(change.permission_code)) {
      return failure('23514')
    }
    if (!point.can_edit) return failure('42501', 'EMPLOYEE_PERMISSION_OVERRIDE_PROTECTED')

    const args = {
      p_actor_id: actor.id,
      p_org_id: orgId.data,
      p_user_id: userId.data,
      p_permission_code: change.permission_code,
      p_expected_override: change.expected_override,
      p_override: change.override,
    }
    const { data, error } = change.target_revision
      ? await supabaseAdmin.rpc('admin_set_employee_prelogin_permission_override_v1', {
        ...args, p_target_revision: change.target_revision,
      })
      : await supabaseAdmin.rpc(organizationAction
        ? 'admin_set_employee_org_permission_override_v1' : 'admin_set_employee_permission_override_v1', args)
    if (error) return failure(error.code, error.details)
    if (!matchesOverride(data, change.override)) return failure()

    const updated = await loadEmployeePermissionTable(userId.data, orgId.data, actor.id)
    if (!updated) return failure('P0002')
    if (updated.target_revision !== snapshot.target_revision) return failure('40001')
    const saved = updated.permissions.find(permission => permission.key === change.permission_code)
    if (!matchesOverride(saved?.override, change.override)) return failure('40001')

    return json({ org_id: orgId.data, user_id: userId.data, ...updated })
  } catch (error) {
    if (error instanceof AuthError) return json({ error: '请先登录。', code: 'UNAUTHORIZED' }, 401)
    return failure()
  }
}

export async function GET(req: NextRequest, context: AsyncRouteParams) {
  return handle(req, context, false)
}

export async function PATCH(req: NextRequest, context: AsyncRouteParams) {
  return handle(req, context, true)
}
