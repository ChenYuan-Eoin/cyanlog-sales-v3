// REQ:F011 - 用户管理扩展：兼职部门管理
// PURPOSE: 添加/删除用户的兼职部门

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { assertDepartmentInOrg, DEPARTMENT_LEDGER_MEMBERSHIP_FORBIDDEN } from '@/lib/admin/org-membership'
import { loadOrganizationPermissionAccess } from '@/lib/admin/member-actions'
import {
  departmentOverrideChoiceRequired, departmentSaveChoiceFields, hasCompleteDepartmentOverrideChoice,
} from '@/lib/admin/member-department-save-contract'
import { ORG_DEPARTMENT_DIRECTORY_VIEW, ORG_MEMBER_EDIT } from '@/lib/permissions'

const uuidSchema = z.string().regex(/^[0-9a-f-]{36}$/i, '部门 ID 格式不正确')

const addDepartmentsSchema = z.object({
  department_ids: z.array(uuidSchema).min(1, '请至少选择一个部门'),
})

const removeDepartmentSchema = z.object({
  department_id: uuidSchema,
})

const verifiedId = z.guid().transform(value => value.toLowerCase())
const saveRequest = z.strictObject({
  action: z.literal('save'), expected_org_id: verifiedId, department_id: verifiedId, operation: z.enum(['add', 'remove']),
  ...departmentSaveChoiceFields,
}).refine(hasCompleteDepartmentOverrideChoice)
const changeResult = z.object({
  action: z.enum(['add', 'remove']),
  affected_department_ids: z.array(z.guid()),
  impact: z.record(z.string(), z.unknown()),
})
const saveResult = z.discriminatedUnion('status', [
  changeResult.extend({ status: z.literal('applied'), effective_at: z.iso.datetime({ offset: true }) }),
  changeResult.extend({ status: z.literal('unchanged'), affected_department_ids: z.array(z.guid()).length(0) }),
  departmentOverrideChoiceRequired,
])

const changeErrors = {
  DEPARTMENT_OVERRIDE_INVALID_CHOICE: [400, '请选择此次调整后的个人权限处理方式。'],
  DEPARTMENT_TRANSFER_FORBIDDEN: [403, '仅当前组织的系统超级管理员可以变更兼职部门。'],
  SECONDARY_DEPARTMENT_INVALID: [400, '请选择当前组织内有效、不重复的兼职部门。'],
  SECONDARY_DEPARTMENT_PRIMARY: [400, '主部门变更需要通过调部门流程处理。'],
  SECONDARY_DEPARTMENT_PROTECTED: [403, '当前账号或受保护的超级管理员不可通过此入口调整部门。'],
  SECONDARY_DEPARTMENT_NOT_FOUND: [404, '当前组织中未找到可调整的在职成员。'],
  SECONDARY_DEPARTMENT_EXTERNAL_SOURCE: [403, '该兼职部门关系由外部目录维护，请在来源系统调整。'],
  SECONDARY_DEPARTMENT_STALE: [409, '权限或部门关系已变更，请重新保存。'],
  SECONDARY_DEPARTMENT_PREVIEW_REQUIRED: [409, '请通过调整部门入口保存。'],
  SECONDARY_DEPARTMENT_CLIENT_UPDATED: [409, '页面已更新，请刷新后重新保存。'],
} as const

function changeFailure(code?: string) {
  if (code && Object.hasOwn(changeErrors, code)) {
    const [status, error] = changeErrors[code as keyof typeof changeErrors]
    return NextResponse.json({ code, error }, { status, headers: { 'Cache-Control': 'no-store' } })
  }
  return NextResponse.json(
    { code: 'SECONDARY_DEPARTMENT_UNAVAILABLE', error: '暂时无法取得兼职部门变更结果，请重新读取成员信息。' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  )
}

function isStructuredChange(body: unknown): body is { action: unknown } {
  return body !== null && typeof body === 'object' && 'action' in body
}

function rejectsOrigin(req: NextRequest) {
  const origin = req.headers.get('origin')
  return origin && origin !== new URL(req.url).origin
}

async function saveSecondaryDepartment(
  body: unknown, actorId: string, orgId: string, userId: string, systemAdministrator: boolean,
) {
  const user = verifiedId.safeParse(userId)
  const parsed = saveRequest.safeParse(body)
  if (!user.success || !parsed.success) return validationError('兼职部门变更参数不正确。')
  const input = parsed.data
  if (input.expected_org_id !== orgId.toLowerCase()) {
    return NextResponse.json({ error: '当前组织已变更，请重新读取成员名单。', code: 'ORGANIZATION_CHANGED' }, { status: 409 })
  }
  if (!systemAdministrator) return changeFailure('DEPARTMENT_TRANSFER_FORBIDDEN')
  if (actorId === user.data) return changeFailure('SECONDARY_DEPARTMENT_PROTECTED')
  const { data, error } = await supabaseAdmin.rpc('save_member_secondary_department_change_v1', {
    p_actor_id: actorId, p_org_id: orgId, p_user_id: user.data, p_department_ids: [input.department_id], p_action: input.operation,
    p_override_choice: input.override_choice ?? null, p_choice_id: input.choice_id ?? null, p_request_id: input.request_id ?? null,
  })
  if (error) return changeFailure(error.details)
  const result = saveResult.safeParse(data)
  return result.success
    ? NextResponse.json(result.data, { headers: { 'Cache-Control': 'no-store' } })
    : changeFailure()
}

function validationError(message: string) {
  return NextResponse.json({ error: message, code: 'VALIDATION_ERROR' }, { status: 400 })
}

// POST /api/admin/users/:id/departments - 添加兼职部门
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params
    const currentUser = await requireAuth(req)
    const access = await loadOrganizationPermissionAccess(currentUser.id)
    if (!access?.decision[ORG_MEMBER_EDIT] || !access.decision[ORG_DEPARTMENT_DIRECTORY_VIEW]) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }
    const { orgId } = access

    if (rejectsOrigin(req)) return NextResponse.json({ error: '请求来源不受信任。', code: 'INVALID_ORIGIN' }, { status: 403 })
    const body = await req.json().catch(() => null)
    if (isStructuredChange(body)) {
      if (body.action === 'preview' || body.action === 'confirm') return changeFailure('SECONDARY_DEPARTMENT_CLIENT_UPDATED')
      return await saveSecondaryDepartment(body, currentUser.id, orgId, userId, access.systemAdministrator)
    }

    const parseResult = addDepartmentsSchema.safeParse(body)
    if (!parseResult.success) {
      return validationError(parseResult.error.issues[0]?.message || '部门参数不正确')
    }
    const { department_ids } = parseResult.data

    // 检查用户是否存在
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('users')
      .select('id, display_name, primary_dept_id, org_id')
      .eq('id', userId)
      .eq('org_id', orgId)
      .single()

    if (checkError || !existing) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    // 检查部门是否都属于当前组织
    const { data: validDepts, error: deptError } = await supabaseAdmin
      .from('departments')
      .select('id')
      .in('id', department_ids)
      .eq('org_id', orgId)

    if (deptError) {
      console.error('Check departments error:', deptError)
      return NextResponse.json({ error: '检查部门失败' }, { status: 500 })
    }

    const validDeptIds = validDepts?.map(d => d.id) || []
    if (validDeptIds.length !== department_ids.length) {
      return NextResponse.json({ error: '部分部门不存在或不在当前组织' }, { status: 400 })
    }

    // 不能添加主属部门作为兼职（已经是主部门了）
    if (existing.primary_dept_id && department_ids.includes(existing.primary_dept_id)) {
      return NextResponse.json({ error: '不能将主属部门设为兼职部门' }, { status: 400 })
    }

    const { data: saved, error: insertError } = await supabaseAdmin.rpc('admin_change_manual_department_membership_v1', {
      p_actor_id: currentUser.id, p_org_id: orgId, p_user_id: userId, p_department_ids: validDeptIds, p_action: 'add',
    })
    if (insertError?.details === 'SECONDARY_DEPARTMENT_PREVIEW_REQUIRED') return changeFailure(insertError.details)
    if (insertError?.details === DEPARTMENT_LEDGER_MEMBERSHIP_FORBIDDEN) {
      return NextResponse.json({ error: '仅系统超级管理员可以调整已获收寄台账权限的部门成员。', code: DEPARTMENT_LEDGER_MEMBERSHIP_FORBIDDEN }, { status: 403 })
    }
    if (insertError || saved !== true) {
      console.error('Add departments error:', insertError)
      return NextResponse.json({ error: '添加兼职部门失败' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: '兼职部门已添加',
      data: { added: validDeptIds.length },
    })
  } catch (err) {
    console.error('POST user departments error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// DELETE /api/admin/users/:id/departments - 删除兼职部门
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params
    const currentUser = await requireAuth(req)
    const access = await loadOrganizationPermissionAccess(currentUser.id)
    if (!access?.decision[ORG_MEMBER_EDIT] || !access.decision[ORG_DEPARTMENT_DIRECTORY_VIEW]) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }
    const { orgId } = access

    if (rejectsOrigin(req)) return NextResponse.json({ error: '请求来源不受信任。', code: 'INVALID_ORIGIN' }, { status: 403 })
    const url = new URL(req.url)
    const deptIdFromQuery = url.searchParams.get('department_id')
    const body = await req.json().catch(() => ({}))
    if (isStructuredChange(body)) return changeFailure('SECONDARY_DEPARTMENT_CLIENT_UPDATED')
    const bodyDeptId = body && typeof body === 'object'
      ? (body as { department_id?: unknown }).department_id
      : undefined
    const rawTargetDeptId = typeof bodyDeptId === 'string' ? bodyDeptId : deptIdFromQuery
    if (!rawTargetDeptId) {
      return validationError('请指定要删除的部门ID')
    }
    const parseResult = removeDepartmentSchema.safeParse({
      department_id: rawTargetDeptId,
    })
    if (!parseResult.success) {
      return validationError(parseResult.error.issues[0]?.message || '请指定要删除的部门ID')
    }
    const targetDeptId = parseResult.data.department_id

    // 检查用户是否存在
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('users')
      .select('id, display_name, primary_dept_id, org_id')
      .eq('id', userId)
      .eq('org_id', orgId)
      .single()

    if (checkError || !existing) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    // 不能删除主属部门
    if (existing.primary_dept_id === targetDeptId) {
      return NextResponse.json({ error: '不能删除主属部门，请先修改主属部门' }, { status: 400 })
    }

    const targetDepartment = await assertDepartmentInOrg(orgId, targetDeptId)
    if (!targetDepartment) {
      return NextResponse.json(
        { error: '部门不存在或不在当前组织', code: 'INVALID_DEPARTMENT' },
        { status: 400 }
      )
    }

    const { data: saved, error: deleteError } = await supabaseAdmin.rpc('admin_change_manual_department_membership_v1', {
      p_actor_id: currentUser.id, p_org_id: orgId, p_user_id: userId, p_department_ids: [targetDeptId], p_action: 'remove',
    })
    if (deleteError?.details === 'SECONDARY_DEPARTMENT_PREVIEW_REQUIRED') return changeFailure(deleteError.details)
    if (deleteError?.details === DEPARTMENT_LEDGER_MEMBERSHIP_FORBIDDEN) {
      return NextResponse.json({ error: '仅系统超级管理员可以调整已获收寄台账权限的部门成员。', code: DEPARTMENT_LEDGER_MEMBERSHIP_FORBIDDEN }, { status: 403 })
    }
    if (deleteError || saved !== true) {
      console.error('Delete department error:', deleteError)
      return NextResponse.json({ error: '删除兼职部门失败' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: '兼职部门已删除',
    })
  } catch (err) {
    console.error('DELETE user departments error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
