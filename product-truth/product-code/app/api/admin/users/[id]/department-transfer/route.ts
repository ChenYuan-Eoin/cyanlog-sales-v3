import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { loadOrganizationPermissionAccess } from '@/lib/admin/member-actions'
import {
  departmentOverrideChoiceRequired, departmentSaveChoiceFields, hasCompleteDepartmentOverrideChoice,
} from '@/lib/admin/member-department-save-contract'
import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'

const guid = z.guid().transform(value => value.toLowerCase())
const transferRequest = z.strictObject({
  action: z.literal('save'), expected_org_id: guid, department_id: guid, keep_previous: z.boolean(),
  ...departmentSaveChoiceFields,
}).refine(hasCompleteDepartmentOverrideChoice)
const appliedOutcome = z.object({
  status: z.literal('applied'),
  department_id: z.guid(),
  secondary_department_ids: z.array(z.guid()),
  impact: z.record(z.string(), z.unknown()),
  effective_at: z.iso.datetime({ offset: true }),
})
const saveOutcome = z.discriminatedUnion('status', [appliedOutcome, departmentOverrideChoiceRequired])

const transferErrors = {
  DEPARTMENT_OVERRIDE_INVALID_CHOICE: [400, '请选择此次调整后的个人权限处理方式。'],
  DEPARTMENT_TRANSFER_FORBIDDEN: [403, '仅当前组织的系统超级管理员可以调整成员部门。'],
  DEPARTMENT_TRANSFER_PROTECTED: [403, '当前账号或受保护的超级管理员不可通过此入口调整部门。'],
  DEPARTMENT_TRANSFER_EXTERNAL_SOURCE: [403, '该成员的主部门由外部目录维护，请在来源系统调整后同步。'],
  DEPARTMENT_TRANSFER_NOT_FOUND: [404, '当前组织中未找到可调部门的在职成员。'],
  DEPARTMENT_TRANSFER_INVALID_TARGET: [400, '请选择当前组织中启用的部门。'],
  DEPARTMENT_TRANSFER_NO_CHANGE: [409, '所选部门已是该员工的主部门。'],
  DEPARTMENT_TRANSFER_STALE: [409, '权限或部门关系已变更，请重新保存。'],
} as const

function fail(status: number, code: string, error: string) {
  return NextResponse.json({ code, error }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const origin = req.headers.get('origin')
    if (origin && origin !== req.nextUrl.origin) return fail(403, 'INVALID_ORIGIN', '请在当前站点发起调部门操作。')
    const actor = await requireAuth(req)
    const user = guid.safeParse((await params).id)
    const body = await req.json().catch(() => null)
    if (body?.action === 'preview' || body?.action === 'confirm') {
      return fail(409, 'DEPARTMENT_TRANSFER_CLIENT_UPDATED', '页面已更新，请刷新后重新保存。')
    }
    const parsed = transferRequest.safeParse(body)
    if (!user.success || !parsed.success) return fail(400, 'VALIDATION_ERROR', '调部门参数不正确。')

    const input = parsed.data
    const access = await loadOrganizationPermissionAccess(actor.id)
    if (!access?.systemAdministrator) {
      return fail(403, 'DEPARTMENT_TRANSFER_FORBIDDEN', transferErrors.DEPARTMENT_TRANSFER_FORBIDDEN[1])
    }
    if (access.orgId !== input.expected_org_id) return fail(409, 'ORGANIZATION_CHANGED', '当前组织已变更，请重新打开成员名单。')
    if (actor.id === user.data) return fail(403, 'DEPARTMENT_TRANSFER_PROTECTED', transferErrors.DEPARTMENT_TRANSFER_PROTECTED[1])

    const scope = { p_org_id: access.orgId, p_actor_id: actor.id, p_user_id: user.data }
    const { data, error } = await supabaseAdmin.rpc('save_member_department_transfer_v1', {
      ...scope, p_department_id: input.department_id, p_keep_previous: input.keep_previous,
      p_override_choice: input.override_choice ?? null, p_choice_id: input.choice_id ?? null, p_request_id: input.request_id ?? null,
    })

    if (error) {
      const code = error.details || ''
      if (Object.hasOwn(transferErrors, code)) {
        const [status, message] = transferErrors[code as keyof typeof transferErrors]
        return fail(status, code, message)
      }
      console.error('Department transfer transaction failed', { operation: input.action, code: error.code })
      return fail(503, 'DEPARTMENT_TRANSFER_UNAVAILABLE', '暂时无法取得调部门结果，请先重新读取成员信息。')
    }

    const result = saveOutcome.safeParse(data)
    if (!result.success) return fail(503, 'DEPARTMENT_TRANSFER_UNAVAILABLE', '暂时无法取得调部门结果，请先重新读取成员信息。')
    return NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof Error && (error.name === 'AuthError' || error.message === 'Unauthorized')) {
      return fail(401, 'UNAUTHORIZED', '请重新登录。')
    }
    console.error('Department transfer failed')
    return fail(503, 'DEPARTMENT_TRANSFER_UNAVAILABLE', '暂时无法取得调部门结果，请先重新读取成员信息。')
  }
}
