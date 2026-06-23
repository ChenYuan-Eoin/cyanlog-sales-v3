// REQ:F005
// PURPOSE: 提交 ASK 回应

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getUserScopedRoleAssignments, getOrgRoleCodes } from '@/lib/scoped-access'

export async function POST(
  req: NextRequest,
  { params }: { params: { askId: string } }
) {
  try {
    const user = await requireAuth(req)
    const askId = params.askId
    const { response_text, attachments } = await req.json()

    // 获取用户角色（取第一个组织级角色）
    const assignments = await getUserScopedRoleAssignments(user.id)
    const roleCodes = getOrgRoleCodes(assignments)
    const primaryRole = roleCodes[0] || 'sales'

    // 创建回应
    const { data: response, error: respError } = await supabaseAdmin
      .from('ask_responses')
      .insert({
        ask_id: askId,
        responder_id: user.id,
        responder_role: primaryRole,
        responder_name: user.display_name || user.email,
        response_text,
        attachments: attachments || [],
      })
      .select()
      .single()

    if (respError) throw respError

    // 更新 ASK 状态为 responded
    await supabaseAdmin
      .from('ask_items')
      .update({
        status: 'responded',
        response_id: response.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', askId)

    return NextResponse.json({ success: true, data: response })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '提交回应失败'
    return NextResponse.json(
      { error: message },
      { status: 500 }
    )
  }
}
