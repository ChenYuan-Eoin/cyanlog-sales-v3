// REQ:F003 - 部门管理 API (单条操作)
// PURPOSE: 部门的更新和删除

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { loadDepartmentStructureContext } from '@/lib/admin/department-actions'

const uuidSchema = z.guid({ error: 'ID 格式不正确' }).transform(value => value.toLowerCase())
const DEPARTMENT_STRUCTURE_FIELDS = 'id, name, code, depth, parent_id, sort_order'
const DEPARTMENT_FULL_FIELDS = 'id, name, code, depth, parent_id, sort_order, member_count, leader_id'
const updateDepartmentSchema = z.object({
  name: z.string().trim().min(1, '部门名称不能为空').max(80, '部门名称不能超过 80 字').optional(),
  code: z.string().trim().min(1, '部门编码不能为空').max(50, '部门编码不能超过 50 字').optional(),
  parent_id: uuidSchema.nullable().optional(),
  leader_id: uuidSchema.nullable().optional(),
  sort_order: z.coerce.number().int().min(0, '排序值不能小于 0').optional(),
  expected_parent_id: uuidSchema.nullable().optional(),
}).refine((value) => Object.keys(value).some(key => key !== 'expected_parent_id'), {
  message: '至少提供一个要更新的字段',
}).refine((value) => value.expected_parent_id === undefined || value.parent_id !== undefined, {
  message: '请选择上级部门',
})

function validationError(result: z.ZodError) {
  return NextResponse.json(
    { error: result.issues[0]?.message || '部门参数不正确', code: 'VALIDATION_ERROR' },
    { status: 400 }
  )
}

function parentChangeError(code?: string, detail?: string) {
  if (code === '40001' || detail === 'DEPARTMENT_PARENT_CHANGED') {
    return NextResponse.json({ error: '部门上级已更新，请刷新后重试。', code: 'DEPARTMENT_MOVE_CHANGED' }, { status: 409 })
  }
  switch (code) {
    case '42501':
      return NextResponse.json({ error: '仅当前组织的有效超管可调整部门上级', code: 'NO_PERMISSION' }, { status: 403 })
    case 'P0002':
      return NextResponse.json({ error: '启用的部门不存在', code: 'DEPARTMENT_NOT_FOUND' }, { status: 404 })
    case '22023':
    case '22P02':
    case '23514':
      return NextResponse.json({ error: '上级部门或部门资料无效，请核对后重试。', code: 'INVALID_DEPARTMENT_MOVE' }, { status: 400 })
    case '23505':
      return NextResponse.json({ error: '部门编码已存在' }, { status: 409 })
    case 'PGRST202':
    case '42883':
      return NextResponse.json({ error: '部门授权服务正在更新，请稍后重试', code: 'DEPARTMENT_MOVE_UNAVAILABLE' }, { status: 503 })
    default:
      return NextResponse.json({ error: '暂时无法调整部门上级', code: 'DEPARTMENT_MOVE_FAILED' }, { status: 500 })
  }
}

async function assertUserInOrg(orgId: string, userId: string | null | undefined) {
  if (!userId) {
    return null
  }

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id')
    .eq('id', userId)
    .eq('org_id', orgId)
    .neq('status', 'inactive')
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return data
}

// PATCH /api/admin/departments/:id - 更新部门
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireAuth(req)
    const access = await loadDepartmentStructureContext(user.id)
    if (!access?.canEdit) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    const parseResult = updateDepartmentSchema.safeParse(await req.json().catch(() => null))
    if (!parseResult.success) {
      return validationError(parseResult.error)
    }
    const { expected_parent_id, ...changes } = parseResult.data
    const { name, code, parent_id, leader_id, sort_order } = changes
    const { orgId, memberAccess } = access
    if (leader_id !== undefined && !memberAccess) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    // 检查部门是否存在
    const departmentTable = supabaseAdmin.from('departments')
    const departmentQuery = memberAccess
      ? departmentTable.select(DEPARTMENT_FULL_FIELDS) : departmentTable.select(DEPARTMENT_STRUCTURE_FIELDS)
    const { data: existing, error: checkError } = await departmentQuery
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (checkError || !existing) {
      return NextResponse.json({ error: '部门不存在' }, { status: 404 })
    }

    const movingDepartment = parent_id !== undefined && parent_id !== existing.parent_id
    if (movingDepartment || (expected_parent_id !== undefined && expected_parent_id !== existing.parent_id)) {
      const origin = req.headers.get('origin')
      if (origin && origin !== new URL(req.url).origin) {
        return NextResponse.json({ error: '请求来源不受信任。', code: 'NO_PERMISSION' }, { status: 403 })
      }
      if (parent_id === id.toLowerCase()) {
        return NextResponse.json({ error: '不能将部门设置为自己的下级' }, { status: 400 })
      }
      const { data, error } = await supabaseAdmin.rpc('admin_save_department_parent_change_v1', {
        p_org_id: orgId, p_actor_id: user.id, p_department_id: id, p_changes: changes,
        p_expected_parent_id: expected_parent_id === undefined ? existing.parent_id : expected_parent_id,
      })
      if (error || !data?.department) return parentChangeError(error?.code, error?.details)
      const { member_count, leader_id: departmentLeaderId, ...structure } = data.department
      const department = memberAccess ? { ...structure, member_count, leader_id: departmentLeaderId } : structure
      return NextResponse.json({ success: true, data: department, message: '部门更新成功' })
    }

    // 如果修改 code，检查唯一性
    if (code) {
      const { data: codeExists } = await supabaseAdmin
        .from('departments')
        .select('id')
        .eq('org_id', orgId)
        .eq('code', code)
        .neq('id', id)
        .maybeSingle()

      if (codeExists) {
        return NextResponse.json({ error: '部门编码已存在' }, { status: 409 })
      }
    }

    const updateData: Record<string, unknown> = {}
    if (leader_id) {
      const leader = await assertUserInOrg(orgId, leader_id)
      if (!leader) {
        return NextResponse.json({ error: '部门主管不存在', code: 'INVALID_LEADER' }, { status: 400 })
      }
    }

    // 更新数据
    if (name !== undefined) updateData.name = name
    if (code !== undefined) updateData.code = code
    if (leader_id !== undefined) updateData.leader_id = leader_id
    if (sort_order !== undefined) updateData.sort_order = sort_order
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ success: true, data: existing, message: '部门信息未变更' })
    }

    const mutation = supabaseAdmin
      .from('departments')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', orgId)
    const selection = memberAccess
      ? mutation.select(DEPARTMENT_FULL_FIELDS) : mutation.select(DEPARTMENT_STRUCTURE_FIELDS)
    const { data, error } = await selection.single()

    if (error) {
      console.error('Update department error:', error)
      return NextResponse.json({ error: '更新部门失败' }, { status: 500 })
    }
    return NextResponse.json({
      success: true,
      data,
      message: '部门更新成功',
    })
  } catch (err) {
    console.error('PATCH department error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// DELETE /api/admin/departments/:id - 删除部门
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const user = await requireAuth(req)
    const access = await loadDepartmentStructureContext(user.id)
    if (!access?.canDelete) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    const { orgId, memberAccess } = access

    // 检查部门是否存在
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('departments')
      .select('id, member_count, name')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (checkError || !existing) {
      return NextResponse.json({ error: '部门不存在' }, { status: 404 })
    }

    // 成员关联也包含未进入同步在职名单的账号。
    if (existing.member_count > 0) {
      return NextResponse.json(
        {
          error: memberAccess
            ? `部门「${existing.name}」还有 ${existing.member_count} 条成员关联，请先调整成员的部门归属`
            : `部门「${existing.name}」仍有成员关联，无法删除`,
          code: 'DEPARTMENT_HAS_MEMBER_BINDINGS',
        },
        { status: 400 }
      )
    }

    // 检查是否有子部门
    const { data: children } = await supabaseAdmin
      .from('departments')
      .select('id')
      .eq('parent_id', id)
      .eq('org_id', orgId)
      .limit(1)

    if (children && children.length > 0) {
      return NextResponse.json(
        { error: `部门 "${existing.name}" 下还有子部门，请先删除子部门` },
        { status: 400 }
      )
    }

    // 软删除：将状态改为 inactive
    const { error } = await supabaseAdmin
      .from('departments')
      .update({ status: 'inactive' })
      .eq('id', id)
      .eq('org_id', orgId)

    if (error) {
      console.error('Delete department error:', error)
      return NextResponse.json({ error: '删除部门失败' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      message: `部门 "${existing.name}" 已删除`,
    })
  } catch (err) {
    console.error('DELETE department error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
