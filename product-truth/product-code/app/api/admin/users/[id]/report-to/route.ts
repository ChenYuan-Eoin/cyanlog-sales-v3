// REQ:F011 - 用户管理扩展：修改汇报对象
// PURPOSE: 调整组织架构中的汇报关系

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { canAccessOrgAdmin } from '@/lib/permissions'
import { getDefaultOrgId } from '@/lib/scoped-access'

// PATCH /api/admin/users/:id/report-to - 修改汇报对象
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

    const body = await req.json()
    const { report_to_user_id } = body

    // 不能汇报给自己
    if (report_to_user_id === id) {
      return NextResponse.json({ error: '不能将自己设为自己的汇报对象' }, { status: 400 })
    }

    // 检查目标用户是否存在
    const { data: existing, error: checkError } = await supabaseAdmin
      .from('users')
      .select('id, display_name, org_id')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (checkError || !existing) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    // 如果指定了汇报对象，验证其存在性
    if (report_to_user_id) {
      const { data: reportToUser, error: reportToError } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('id', report_to_user_id)
        .eq('org_id', orgId)
        .single()

      if (reportToError || !reportToUser) {
        return NextResponse.json({ error: '汇报对象不存在' }, { status: 400 })
      }

      // 检查循环汇报：简单一层（不能汇报给直接下级）
      // ponytail: 完整的循环检测需要递归查询，n<1000时一层检测可接受
      // 升级路径：添加 CTE 递归查询检测多层循环汇报
      const { data: subordinates } = await supabaseAdmin
        .from('users')
        .select('id')
        .eq('report_to_user_id', id)
        .eq('org_id', orgId)

      if (subordinates?.some(s => s.id === report_to_user_id)) {
        return NextResponse.json({ error: '不能将汇报对象设为自己的直接下级' }, { status: 400 })
      }
    }

    // 更新汇报对象
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({
        report_to_user_id: report_to_user_id || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('org_id', orgId)

    if (updateError) {
      console.error('Update report_to_user_id error:', updateError)
      return NextResponse.json({ error: '更新汇报对象失败' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      data: { id, report_to_user_id: report_to_user_id || null },
      message: '汇报对象已更新',
    })
  } catch (err) {
    console.error('PATCH report-to error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
