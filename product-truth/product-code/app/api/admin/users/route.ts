// REQ:F003 - 用户管理 API
// PURPOSE: 用户的增删改查

import { NextRequest, NextResponse } from 'next/server'
import { createHash, randomBytes } from 'node:crypto'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import {
  canMutateOrgDepartments,
  getDefaultOrgId,
  getFreshDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import {
  assertDepartmentInOrg,
  ensureDefaultOrganizationMembership,
  syncPrimaryDepartmentMembership,
  syncUserSalesSpaces,
} from '@/lib/admin/org-membership'
import { validateOrgRoleAssignment } from '@/lib/admin/org-role-authority'
import { canPerformMemberAction } from '@/lib/admin/member-actions'
import { ORG_MEMBER_INVITE } from '@/lib/admin/member-action-keys'
import { ORG_BUSINESS_ROLE_ASSIGN } from '@/lib/permissions'
import { normalizeIdentityPhone } from '@/lib/fxiaoke/identity'

const createUserSchema = z.object({
  email: z.string().trim().email('请输入有效的邮箱地址').transform((value) => value.toLowerCase()),
  phone: z.string().trim().min(1, '手机号不能为空'),
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
        user_roles!user_roles_user_id_fkey(
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
    const orgId = await getFreshDefaultOrgId(currentUser.id)
    const actorAssignments = await getFreshUserScopedRoleAssignments(currentUser.id)

    if (!canPerformMemberAction(actorAssignments, orgId, ORG_MEMBER_INVITE)) {
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

    const { email, display_name, title, primary_dept_id, role_ids } = parseResult.data
    const phone = normalizeIdentityPhone(parseResult.data.phone)
    if (!phone) {
      return NextResponse.json({ error: '手机号格式不正确', code: 'INVALID_PHONE' }, { status: 400 })
    }

    if (primary_dept_id && !canMutateOrgDepartments(actorAssignments, orgId)) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_DEPARTMENT_PERMISSION' }, { status: 403 })
    }

    if (role_ids.length > 0 && !canPerformMemberAction(actorAssignments, orgId, ORG_BUSINESS_ROLE_ASSIGN)) {
      return NextResponse.json({ error: '无权预分配成员角色', code: 'NO_ROLE_ASSIGN_PERMISSION' }, { status: 403 })
    }
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
    const { data: existingPhone } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('org_id', orgId)
      .eq('phone', phone)
      .eq('status', 'active')
      .maybeSingle()
    if (existingPhone) {
      return NextResponse.json({ error: '该手机号已被使用' }, { status: 409 })
    }

    const activationCode = randomBytes(24).toString('base64url')
    const activationTokenHash = createHash('sha256').update(activationCode).digest('hex')
    const activationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    // 创建用户
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        org_id: orgId,
        email,
        phone,
        display_name,
        title: title || null,
        primary_dept_id: primary_dept_id || null,
        status: 'inactive',
        login_enabled: false,
      })
      .select('id, email, display_name, title, primary_dept_id, status')
      .single()

    if (userError || !user) {
      console.error('Create user error:', userError)
      return NextResponse.json({ error: '创建用户失败' }, { status: 500 })
    }

    try {
      await ensureDefaultOrganizationMembership(user.id, orgId)
      const { error: invitedMembershipError } = await supabaseAdmin
        .from('user_organizations')
        .update({ status: 'invited', employment_status: 'active' })
        .eq('user_id', user.id)
        .eq('org_id', orgId)
      if (invitedMembershipError) throw invitedMembershipError
      if (primary_dept_id) {
        await syncPrimaryDepartmentMembership(user.id, primary_dept_id, orgId)
        await syncUserSalesSpaces(user.id, orgId, primary_dept_id)
      }
      const { error: invitationError } = await supabaseAdmin
        .from('personnel_invitations')
        .insert({
          org_id: orgId,
          user_id: user.id,
          token_hash: activationTokenHash,
          role_ids: roleValidation.roleIds,
          status: 'pending',
          delivery_method: 'manual_handoff',
          expires_at: activationExpiresAt,
          created_by: currentUser.id,
        })
      if (invitationError) throw invitationError
    } catch (syncError) {
      console.error('Create user consistency error:', syncError)
      await supabaseAdmin.from('users').delete().eq('id', user.id).eq('org_id', orgId)
      return NextResponse.json({ error: '创建用户关联数据失败' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: {
        ...user,
        activationCode,
        activationExpiresAt,
        deliveryMethod: 'manual_handoff',
      },
      message: '成员邀请已创建，需由管理员安全交付激活码',
    }, { status: 201 })
  } catch (err) {
    console.error('POST user error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
