// REQ:F003 - 用户角色管理 API
// PURPOSE: 为用户分配角色

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { canAccessOrgAdmin } from '@/lib/permissions'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { replaceOrgRoleIds } from '@/lib/admin/org-membership'

const assignOrgRolesSchema = z.object({
  role_ids: z.array(z.string().regex(/^[0-9a-f-]{36}$/i, '角色 ID 格式不正确')),
  scope_type: z.literal('org').optional().default('org'),
  scope_id: z.string().regex(/^[0-9a-f-]{36}$/i, '作用域 ID 格式不正确').nullable().optional(),
})

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

    const parseResult = assignOrgRolesSchema.safeParse(await req.json().catch(() => null))
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0]
      return NextResponse.json(
        { error: firstIssue?.message || '角色参数不正确', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }

    const { role_ids } = parseResult.data

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

    let data
    try {
      data = await replaceOrgRoleIds(userId, orgId, role_ids, currentUser.id)
    } catch (error) {
      if (error instanceof Error && error.message === 'ROLE_NOT_FOUND') {
        return NextResponse.json({ error: '部分角色不存在' }, { status: 400 })
      }
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
