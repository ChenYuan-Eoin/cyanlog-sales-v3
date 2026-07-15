// REQ:F011 - 用户管理扩展：兼职部门管理
// PURPOSE: 添加/删除用户的兼职部门

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { assertDepartmentInOrg } from '@/lib/admin/org-membership'
import {
  canMutateOrgUsers,
  getDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'

const uuidSchema = z.string().regex(/^[0-9a-f-]{36}$/i, '部门 ID 格式不正确')

const addDepartmentsSchema = z.object({
  department_ids: z.array(uuidSchema).min(1, '请至少选择一个部门'),
})

const removeDepartmentSchema = z.object({
  department_id: uuidSchema,
})

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
    const orgId = await getDefaultOrgId(currentUser.id)
    const actorAssignments = await getFreshUserScopedRoleAssignments(currentUser.id)

    if (!canMutateOrgUsers(actorAssignments, orgId)) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    const parseResult = addDepartmentsSchema.safeParse(await req.json().catch(() => null))
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

    // 批量添加兼职部门（跳过已存在的）
    const assignments = validDeptIds.map((deptId: string) => ({
      user_id: userId,
      department_id: deptId,
      is_primary: false,
    }))

    const { error: insertError } = await supabaseAdmin
      .from('user_departments')
      .upsert(assignments, { onConflict: 'user_id,department_id' })

    if (insertError) {
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
    const orgId = await getDefaultOrgId(currentUser.id)
    const actorAssignments = await getFreshUserScopedRoleAssignments(currentUser.id)

    if (!canMutateOrgUsers(actorAssignments, orgId)) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    const url = new URL(req.url)
    const deptIdFromQuery = url.searchParams.get('department_id')
    const body = await req.json().catch(() => ({}))
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

    // 删除兼职部门关联
    const { error: deleteError } = await supabaseAdmin
      .from('user_departments')
      .delete()
      .eq('user_id', userId)
      .eq('department_id', targetDeptId)
      .eq('is_primary', false)

    if (deleteError) {
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
