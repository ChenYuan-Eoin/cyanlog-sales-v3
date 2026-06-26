// REQ:F003 - 部门管理 API (单条操作)
// PURPOSE: 部门的更新和删除

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { canAccessOrgAdmin } from '@/lib/permissions'
import { getDefaultOrgId } from '@/lib/scoped-access'

const uuidSchema = z.string().regex(/^[0-9a-f-]{36}$/i, 'ID 格式不正确')
const updateDepartmentSchema = z.object({
  name: z.string().trim().min(1, '部门名称不能为空').max(80, '部门名称不能超过 80 字').optional(),
  code: z.string().trim().min(1, '部门编码不能为空').max(50, '部门编码不能超过 50 字').optional(),
  parent_id: uuidSchema.nullable().optional(),
  leader_id: uuidSchema.nullable().optional(),
  sort_order: z.coerce.number().int().min(0, '排序值不能小于 0').optional(),
}).refine((value) => Object.keys(value).length > 0, {
  message: '至少提供一个要更新的字段',
})

function validationError(result: z.ZodError) {
  return NextResponse.json(
    { error: result.issues[0]?.message || '部门参数不正确', code: 'VALIDATION_ERROR' },
    { status: 400 }
  )
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
    const orgId = await getDefaultOrgId(user.id)

    // 权限检查
    const userPerms = req.headers.get('x-user-permissions')?.split(',') || []
    const roleCodes = req.headers.get('x-user-role-codes')?.split(',') || []

    if (!canAccessOrgAdmin(userPerms, roleCodes)) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    const parseResult = updateDepartmentSchema.safeParse(await req.json())
    if (!parseResult.success) {
      return validationError(parseResult.error)
    }
    const { name, code, parent_id, leader_id, sort_order } = parseResult.data

    // 检查部门是否存在
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('departments')
      .select('id, depth, parent_id')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (checkError || !existing) {
      return NextResponse.json({ error: '部门不存在' }, { status: 404 })
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

    // 计算新的 depth（如果 parent_id 改变）
    let depth = existing.depth
    if (parent_id !== undefined && parent_id !== existing.parent_id) {
      if (parent_id === null) {
        depth = 0
      } else {
        // 检查新上级是否存在且不是当前部门或其子部门
        const { data: parent, error: parentError } = await supabaseAdmin
          .from('departments')
          .select('depth, path')
          .eq('id', parent_id)
          .eq('org_id', orgId)
          .single()

        if (parentError || !parent) {
          return NextResponse.json({ error: '上级部门不存在' }, { status: 400 })
        }

        // 防止循环引用
        if (parent.path?.includes(id)) {
          return NextResponse.json({ error: '不能将部门设置为其子部门的下级' }, { status: 400 })
        }

        depth = (parent.depth || 0) + 1
      }
    }

    if (leader_id) {
      const leader = await assertUserInOrg(orgId, leader_id)
      if (!leader) {
        return NextResponse.json({ error: '部门主管不存在', code: 'INVALID_LEADER' }, { status: 400 })
      }
    }

    // 更新数据
    const updateData: Record<string, unknown> = {}
    if (name !== undefined) updateData.name = name
    if (code !== undefined) updateData.code = code
    if (parent_id !== undefined) updateData.parent_id = parent_id
    if (leader_id !== undefined) updateData.leader_id = leader_id
    if (depth !== undefined) updateData.depth = depth
    if (sort_order !== undefined) updateData.sort_order = sort_order

    const { data, error } = await supabaseAdmin
      .from('departments')
      .update(updateData)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('id, name, code, depth, member_count, parent_id, leader_id, sort_order')
      .single()

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
    const orgId = await getDefaultOrgId(user.id)

    // 权限检查
    const userPerms = req.headers.get('x-user-permissions')?.split(',') || []
    const roleCodes = req.headers.get('x-user-role-codes')?.split(',') || []

    if (!canAccessOrgAdmin(userPerms, roleCodes)) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

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

    // 检查是否有成员
    if (existing.member_count > 0) {
      return NextResponse.json(
        { error: `部门 "${existing.name}" 下还有 ${existing.member_count} 名成员，请先转移或删除成员` },
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
