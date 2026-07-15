// REQ:F003 - 用户管理 API
// PURPOSE: 用户的增删改查

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import {
  canMutateOrgUsers,
  getDefaultOrgId,
  getUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import {
  assertDepartmentInOrg,
  createAdminTempPassword,
  ensureDefaultOrganizationMembership,
  hashAdminPassword,
  replaceOrgRoleIds,
  syncPrimaryDepartmentMembership,
  syncUserSalesSpaces,
} from '@/lib/admin/org-membership'
import { validateOrgRoleAssignment } from '@/lib/admin/org-role-authority'

const createUserSchema = z.object({
  email: z.string().trim().email('请输入有效的邮箱地址').transform((value) => value.toLowerCase()),
  display_name: z.string().trim().min(1, '姓名不能为空'),
  title: z.string().trim().nullable().optional(),
  primary_dept_id: z.string().regex(/^[0-9a-f-]{36}$/i, '主部门 ID 格式不正确').nullable().optional(),
  role_ids: z.array(z.string().regex(/^[0-9a-f-]{36}$/i, '角色 ID 格式不正确')).optional().default([]),
  status: z.enum(['active', 'inactive', 'suspended']).optional().default('active'),
})

// GET /api/admin/users - 获取用户列表
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)

    const { searchParams } = new URL(req.url)
    const deptId = searchParams.get('dept_id')

    let query = supabaseAdmin
      .from('users')
      .select(`
        id,
        email,
        display_name,
        title,
        primary_dept_id,
        departments:departments!primary_dept_id(name),
        status,
        created_at,
        user_roles(
          role:role_id(name, code)
        )
      `)
      .eq('org_id', orgId)
      .neq('status', 'inactive')

    if (deptId) {
      query = query.eq('primary_dept_id', deptId)
    }

    const { data: users, error } = await query.order('created_at', { ascending: false })

    if (error) {
      console.error('Fetch users error:', error)
      return NextResponse.json({ error: '获取用户列表失败' }, { status: 500 })
    }

    // 格式化返回数据
    const formattedUsers = (users || []).map((u: Record<string, unknown>) => ({
      ...u,
      primary_dept_name: (u.departments as { name?: string } | null)?.name || null,
      role_names: ((u.user_roles as Array<{ role?: { name?: string } | null }> | undefined) || [])
        .map((ur) => ur.role?.name)
        .filter((name): name is string => Boolean(name))
        .join(', ') || '',
    }))

    return NextResponse.json({
      success: true,
      data: formattedUsers,
    })
  } catch (err) {
    console.error('GET users error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// POST /api/admin/users - 创建用户
export async function POST(req: NextRequest) {
  try {
    const currentUser = await requireAuth(req)
    const orgId = await getDefaultOrgId(currentUser.id)
    const actorAssignments = await getUserScopedRoleAssignments(currentUser.id)

    if (!canMutateOrgUsers(actorAssignments, orgId)) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    const parseResult = createUserSchema.safeParse(await req.json().catch(() => null))
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0]
      return NextResponse.json(
        { error: firstIssue?.message || '用户参数不正确', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const { email, display_name, title, primary_dept_id, role_ids, status } = parseResult.data
    const roleValidation = await validateOrgRoleAssignment(actorAssignments, orgId, role_ids)
    if (!roleValidation.ok && roleValidation.reason === 'ROLE_NOT_FOUND') {
      return NextResponse.json({ error: '部分角色不存在' }, { status: 400 })
    }
    if (!roleValidation.ok) {
      return NextResponse.json(
        { error: '不能分配超过当前操作者权限上限的角色', code: 'ROLE_ESCALATION_FORBIDDEN' },
        { status: 403 }
      )
    }

    if (primary_dept_id) {
      const department = await assertDepartmentInOrg(orgId, primary_dept_id)
      if (!department) {
        return NextResponse.json({ error: '主部门不存在', code: 'INVALID_PRIMARY_DEPARTMENT' }, { status: 400 })
      }
    }

    // 检查邮箱唯一性
    const { data: existing } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('org_id', orgId)
      .eq('email', email)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: '该邮箱已被使用' }, { status: 409 })
    }

    const tempPassword = createAdminTempPassword()
    const passwordHash = await hashAdminPassword(tempPassword)

    // 创建用户
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        org_id: orgId,
        email,
        display_name,
        title: title || null,
        primary_dept_id: primary_dept_id || null,
        password_hash: passwordHash,
        must_change_password: true,
        status,
      })
      .select('id, email, display_name, title, primary_dept_id, status')
      .single()

    if (userError || !user) {
      console.error('Create user error:', userError)
      return NextResponse.json({ error: '创建用户失败' }, { status: 500 })
    }

    try {
      await ensureDefaultOrganizationMembership(user.id, orgId)
      await syncPrimaryDepartmentMembership(user.id, primary_dept_id || null)
      await syncUserSalesSpaces(user.id, orgId, primary_dept_id || null)
      await replaceOrgRoleIds(user.id, orgId, roleValidation.roleIds, currentUser.id)
    } catch (syncError) {
      console.error('Create user consistency error:', syncError)
      await supabaseAdmin.from('users').delete().eq('id', user.id)
      return NextResponse.json({ error: '创建用户关联数据失败' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: {
        ...user,
        tempPassword,
      },
      message: '用户创建成功',
    }, { status: 201 })
  } catch (err) {
    console.error('POST user error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
