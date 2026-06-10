// REQ: F005 - ASK 回应 API
// PURPOSE: 提交 ASK 回应（1:1 一次回答）

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthUser } from '@/lib/auth'

interface RouteParams {
  params: Promise<{ askId: string }> | { askId: string }
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const resolvedParams = await params
    const { askId } = resolvedParams

    // 获取当前用户
    const user = await getAuthUser(request)
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const body = await request.json()
    const { response_text, attachments = [] } = body

    // 验证必填字段
    if (!response_text || response_text.trim() === '') {
      return NextResponse.json(
        { error: 'Response text is required' },
        { status: 400 }
      )
    }

    // 获取 ASK 详情
    const { data: ask, error: askError } = await supabaseAdmin
      .from('ask_items')
      .select('*, contracts(org_id)')
      .eq('id', askId)
      .single()

    if (askError || !ask) {
      return NextResponse.json(
        { error: 'ASK not found' },
        { status: 404 }
      )
    }

    // 检查 ASK 状态
    if (ask.status === 'responded') {
      return NextResponse.json(
        {
          error: 'RESPONSE_ALREADY_EXISTS',
          message: 'This ASK has already been responded to. Please contact legal to reopen if modification is needed.',
        },
        { status: 409 }
      )
    }

    if (ask.status === 'closed') {
      return NextResponse.json(
        {
          error: 'ASK_CLOSED',
          message: 'This ASK has been closed by legal.',
        },
        { status: 400 }
      )
    }

    // 开始事务
    const now = new Date().toISOString()

    // 1. 创建回应记录
    const { data: response, error: responseError } = await supabaseAdmin
      .from('ask_responses')
      .insert({
        ask_id: askId,
        responder_id: user.id,
        responder_role: 'unknown', // TODO: 从用户角色表获取
        responder_name: user.display_name || user.email || 'Unknown',
        response_text: response_text.trim(),
        attachments: attachments,
      })
      .select()
      .single()

    if (responseError) {
      console.error('[ASK Response] Create error:', responseError)
      return NextResponse.json(
        { error: 'Failed to create response' },
        { status: 500 }
      )
    }

    // 2. 更新 ASK 状态
    const { error: updateError } = await supabaseAdmin
      .from('ask_items')
      .update({
        status: 'responded',
        response_id: response.id,
        updated_at: now,
      })
      .eq('id', askId)

    if (updateError) {
      console.error('[ASK Response] Update ASK error:', updateError)
      return NextResponse.json(
        { error: 'Failed to update ASK status' },
        { status: 500 }
      )
    }

    // 3. 记录审计日志
    const { error: auditError } = await supabaseAdmin
      .from('ask_audit_logs')
      .insert({
        ask_id: askId,
        contract_id: ask.contract_id,
        actor_id: user.id,
        actor_role: 'unknown', // TODO: 从用户角色表获取
        event_type: 'responded',
        from_status: 'pending',
        to_status: 'responded',
        payload: {
          response_id: response.id,
        },
      })

    if (auditError) {
      console.error('[ASK Response] Audit log error:', auditError)
      // 非阻塞错误，继续执行
    }

    // 4. 触发报告升版（异步）
    // TODO: 调用 report version manager 生成新版本报告
    // 这里暂时只返回成功，实际应在后台任务中完成

    return NextResponse.json({
      success: true,
      data: {
        response: response,
        ask_status_after: 'responded',
        message: 'Response submitted successfully. Report version will be updated.',
      },
    }, { status: 201 })
  } catch (error) {
    console.error('[ASK Response] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
