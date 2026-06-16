// REQ:F003 - 用户管理 API
// PURPOSE: 用户的增删改查

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { canAccessOrgAdmin } from '@/lib/permissions'

// GET /api/admin/users - 获取用户列表
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const { orgId } = user

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

    if (deptId) {
      query = query.eq('primary_dept_id', deptId)
    }

    const { data: users, error } = await query.order('created_at', { ascending: false })

    if (error) {
      console.error('Fetch users error:', error)
      return NextResponse.json({ error: '获取用户列表失败' }, { status: 500 })
    }

    // 格式化返回数据
    const formattedUsers = (users || []).map((u: any) => ({
      ...u,
      primary_dept_name: u.departments?.name || null,
      role_names: u.user_roles
        ?.map((ur: any) => ur.role?.name)
        .filter(Boolean)
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
    const { orgId } = currentUser

    // 权限检查
    const userPerms = req.headers.get('x-user-permissions')?.split(',') || []
    const roleCodes = req.headers.get('x-user-role-codes')?.split(',') || []

    if (!canAccessOrgAdmin(userPerms, roleCodes)) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    const body = await req.json()
    const { email, display_name, title, primary_dept_id, role_ids } = body

    // 校验
    if (!email || !display_name) {
      return NextResponse.json({ error: '邮箱和姓名不能为空' }, { status: 400 })
    }

    // 检查邮箱唯一性
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('org_id', orgId)
      .eq('email', email)
      .single()

    if (existing) {
      return NextResponse.json({ error: '该邮箱已被使用' }, { status: 409 })
    }

    // 创建用户
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .insert({
        org_id: orgId,
        email,
        display_name,
        title: title || null,
        primary_dept_id: primary_dept_id || null,
        status: 'active',
      })
      .select('id, email, display_name, title, primary_dept_id, status')
      .single()

    if (userError || !user) {
      console.error('Create user error:', userError)
      return NextResponse.json({ error: '创建用户失败' }, { status: 500 })
    }

    // 分配角色（如果有）
    if (role_ids && role_ids.length > 0) {
      const roleAssignments = role_ids.map((roleId: string) => ({
        user_id: user.id,
        role_id: roleId,
        scope_type: 'org',
        granted_by: currentUser.id,
      }))

      const { error: roleError } = await supabaseAdmin
        .from('user_roles')
        .insert(roleAssignments)

      if (roleError) {
        console.error('Assign roles error:', roleError)
        // 不阻断，继续返回创建成功的用户
      }
    }

    return NextResponse.json({
      success: true,
      data: user,
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
