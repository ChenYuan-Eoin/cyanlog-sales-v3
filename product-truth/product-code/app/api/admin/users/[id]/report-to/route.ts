// REQ:F011 - 用户管理扩展：修改汇报对象
// PURPOSE: 调整组织架构中的汇报关系

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import {
  canMutateOrgUsers,
  getDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import { userHasOrgRoleCode } from '@/lib/admin/org-role-authority'

const reportToSchema = z.object({
  report_to_user_id: z
    .string()
    .regex(/^[0-9a-f-]{36}$/i, '直属上级 ID 格式不正确')
    .nullable(),
})

// PATCH /api/admin/users/:id/report-to - 修改汇报对象
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const currentUser = await requireAuth(req)
    const orgId = await getDefaultOrgId(currentUser.id)

    const assignments = await getFreshUserScopedRoleAssignments(currentUser.id)
    if (!canMutateOrgUsers(assignments, orgId)) {
      return NextResponse.json({ error: 'Forbidden', code: 'NO_PERMISSION' }, { status: 403 })
    }

    const parseResult = reportToSchema.safeParse(await req.json().catch(() => null))
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0]
      return NextResponse.json(
        { error: firstIssue?.message || '汇报对象参数不正确', code: 'VALIDATION_ERROR' },
        { status: 400 }
      )
    }
    const { report_to_user_id } = parseResult.data

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
      .maybeSingle()

    if (checkError) {
      console.error('Update report-to target lookup error:', checkError)
      return NextResponse.json({ error: '更新汇报对象失败' }, { status: 500 })
    }
    if (!existing) {
      return NextResponse.json({ error: '用户不存在' }, { status: 404 })
    }

    if (await userHasOrgRoleCode(id, orgId, 'SUPER_ADMIN')) {
      return NextResponse.json(
        { error: '不允许修改平台根管理员的汇报关系', code: 'PROTECTED_ROLE_MUTATION_FORBIDDEN' },
        { status: 403 }
      )
    }

    const { data: updated, error: updateError } = await supabaseAdmin.rpc(
      'admin_set_reporting_manager_v1',
      {
        p_actor_id: currentUser.id,
        p_org_id: orgId,
        p_user_id: id,
        p_manager_user_id: report_to_user_id,
        p_reason: 'tenant reporting manager update',
        p_request_id: req.headers.get('x-request-id'),
      },
    )

    if (updateError) {
      if (String(updateError.code || '') === '23514') {
        return NextResponse.json({
          error: '汇报对象不存在、未激活或会形成循环',
          code: 'INVALID_REPORT_TO_USER',
        }, { status: 400 })
      }
      console.error('Update report_to_user_id error:', updateError)
      return NextResponse.json({ error: '更新汇报对象失败' }, { status: 500 })
    }
    if (updated !== true) {
      return NextResponse.json({ error: '用户不存在或已离职' }, { status: 404 })
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
