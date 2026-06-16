// REQ:F003 - 用户角色管理 API
// PURPOSE: 为用户分配角色

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { canAccessOrgAdmin } from '@/lib/permissions'
import { getDefaultOrgId } from '@/lib/scoped-access'

// POST /api/admin/users/:id/roles - 分配角色
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: userId } = await params
    const currentUser = await requireAuth(req)
    const orgId = await getDefaultOrgId(currentUser.id)

    // 权限检查
    const userPerms = req.headers.get('x-user-permissions')?.split(',') || []
    const roleCodes = req.headers.get('x-user-role-codes')?.split(',') || []

    if (!canAccessOrgAdmin(userPerms, roleCodes)) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    const body = await req.json()
    const { role_ids, scope_type = 'org', scope_id = null } = body

    // 校验
    if (!role_ids || !Array.isArray(role_ids) || role_ids.length === 0) {
      return NextResponse.json({ error: '请至少选择一个角色' }, { status: 400 })
    }

    // 检查用户是否存在
    const { data: userExists, error: userCheckError } = await supabaseAdmin
      .from('users')
      .select('id, display_name')
      .eq('id', userId)
      .eq('org_id', orgId)
      .single()

    if (userCheckError || !userExists) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    // 检查角色是否存在且属于当前组织（全局角色不检查org_id）
    const { data: validRoles, error: roleCheckError } = await supabaseAdmin
      .from('roles')
      .select('id')
      .in('id', role_ids)

    if (roleCheckError) {
      console.error('Check roles error:', roleCheckError)
      return NextResponse.json({ error: '检查角色失败' }, { status: 500 })
    }

    const validRoleIds = validRoles?.map(r => r.id) || []
    if (validRoleIds.length !== role_ids.length) {
      return NextResponse.json({ error: '部分角色不存在' }, { status: 400 })
    }

    // 先删除该用户在该范围内的现有角色
    const { error: deleteError } = await supabaseAdmin
      .from('user_roles')
      .delete()
      .eq('user_id', userId)
      .eq('scope_type', scope_type)
      .eq('scope_id', scope_id || null)

    if (deleteError) {
      console.error('Delete existing roles error:', deleteError)
      return NextResponse.json({ error: '更新角色失败' }, { status: 500 })
    }

    // 插入新角色
    const roleAssignments = validRoleIds.map((roleId: string) => ({
      user_id: userId,
      role_id: roleId,
      scope_type,
      scope_id: scope_id || null,
      granted_by: currentUser.id,
    }))

    const { data, error } = await supabaseAdmin
      .from('user_roles')
      .insert(roleAssignments)
      .select(`
        id,
        role:role_id(id, name, code),
        scope_type,
        scope_id
      `)

    if (error) {
      console.error('Assign roles error:', error)
      return NextResponse.json({ error: '分配角色失败' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data,
      message: '角色分配成功',
    })
  } catch (err) {
    console.error('POST user roles error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
