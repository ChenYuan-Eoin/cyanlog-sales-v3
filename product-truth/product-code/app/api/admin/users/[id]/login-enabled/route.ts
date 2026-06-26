// REQ:F011 - 用户管理扩展：登录启用/禁用
// PURPOSE: 管理员控制用户是否可以登录系统

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { canAccessOrgAdmin } from '@/lib/permissions'
import { getDefaultOrgId } from '@/lib/scoped-access'

const loginEnabledSchema = z.object({
  login_enabled: z.boolean(),
})

// PATCH /api/admin/users/:id/login-enabled - 修改登录状态
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const currentUser = await requireAuth(req)
    const orgId = await getDefaultOrgId(currentUser.id)

    // 权限检查
    const userPerms = req.headers.get('x-user-permissions')?.split(',') || []
    const roleCodes = req.headers.get('x-user-role-codes')?.split(',') || []

    if (!canAccessOrgAdmin(userPerms, roleCodes)) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    // 不能禁用当前登录用户
    if (id === currentUser.id) {
      return NextResponse.json({ error: '不能禁用当前登录的用户' }, { status: 400 })
    }

    const parseResult = loginEnabledSchema.safeParse(await req.json().catch(() => null))
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'login_enabled 必须为布尔值', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }
    const { login_enabled } = parseResult.data

    // 检查用户是否存在
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('users')
      .select('id, display_name, org_id')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (checkError || !existing) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    // 更新登录状态
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        login_enabled: login_enabled,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)

    if (updateError) {
      console.error('Update login_enabled error:', updateError)
      return NextResponse.json({ error: '更新登录状态失败' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: { id, login_enabled },
      message: login_enabled ? '已允许登录' : '已禁止登录',
    })
  } catch (err) {
    console.error('PATCH login-enabled error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
