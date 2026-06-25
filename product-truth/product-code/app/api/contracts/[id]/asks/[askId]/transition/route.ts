// REQ: F005 - ASK 状态流转 API
// PURPOSE: 关闭/重开 ASK（法务权限）

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import {
  canReviewContracts,
  getAccessibleContract,
  getOrgRoleCodes,
} from '@/lib/scoped-access'

interface RouteParams {
  params: Promise<{ id: string; askId: string }> | { id: string; askId: string }
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const resolvedParams = await params
    const { id: contractId, askId } = resolvedParams

    const user = await requireAuth(request)

    const access = await getAccessibleContract(contractId, user.id, undefined, 'id')
    if (!access.contract) {
      return NextResponse.json(
        { error: 'Contract not found' },
        { status: 404 }
      )
    }

    if (!canReviewContracts(access.assignments)) {
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { action, reason } = body

    if (!action || !['close', 'reopen'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Must be "close" or "reopen"' },
        { status: 400 }
      )
    }

    // close 必须填写 reason
    if (action === 'close' && (!reason || reason.trim() === '')) {
      return NextResponse.json(
        { error: 'Reason is required when closing ASK' },
        { status: 400 }
      )
    }

    // 获取 ASK 详情
    const { data: ask, error: askError } = await supabaseAdmin
      .from('ask_items')
      .select('*')
      .eq('id', askId)
      .eq('contract_id', contractId)
      .single()

    if (askError || !ask) {
      return NextResponse.json(
        { error: 'ASK not found' },
        { status: 404 }
      )
    }

    const now = new Date().toISOString()
    const fromStatus = ask.status
    let toStatus: string
    let eventType: string

    if (action === 'close') {
      // 关闭 ASK
      if (ask.status === 'closed') {
        return NextResponse.json(
          { error: 'ASK already closed' },
          { status: 400 }
        )
      }

      toStatus = 'closed'
      eventType = 'closed'

      const { error: updateError } = await supabaseAdmin
        .from('ask_items')
        .update({
          status: 'closed',
          closed_by: user.id,
          closed_reason: reason.trim(),
          updated_at: now,
        })
        .eq('id', askId)
        .eq('contract_id', contractId)

      if (updateError) {
        console.error('[ASK Transition] Close error:', updateError)
        return NextResponse.json(
          { error: 'Failed to close ASK' },
          { status: 500 }
        )
      }
    } else {
      // 重开 ASK
      if (ask.status !== 'responded' && ask.status !== 'closed') {
        return NextResponse.json(
          { error: 'Only responded or closed ASK can be reopened' },
          { status: 400 }
        )
      }

      toStatus = 'pending'
      eventType = 'reopened'

      const { error: updateError } = await supabaseAdmin
        .from('ask_items')
        .update({
          status: 'pending',
          // 保留原来的回应记录，但状态变为 pending 允许重新回应
          updated_at: now,
        })
        .eq('id', askId)
        .eq('contract_id', contractId)

      if (updateError) {
        console.error('[ASK Transition] Reopen error:', updateError)
        return NextResponse.json(
          { error: 'Failed to reopen ASK' },
          { status: 500 }
        )
      }
    }

    // 记录审计日志
    const { error: auditError } = await supabaseAdmin
      .from('ask_audit_logs')
      .insert({
        ask_id: askId,
        contract_id: ask.contract_id,
        actor_id: user.id,
        actor_role: getOrgRoleCodes(access.assignments)[0] || 'unknown',
        event_type: eventType,
        from_status: fromStatus,
        to_status: toStatus,
        payload: {
          reason: reason || null,
        },
      })

    if (auditError) {
      console.error('[ASK Transition] Audit log error:', auditError)
    }

    return NextResponse.json({
      success: true,
      data: {
        ask_id: askId,
        new_status: toStatus,
        message: action === 'close'
          ? 'ASK closed successfully. Closed ASK will not appear in the report.'
          : 'ASK reopened successfully. New response can be submitted.',
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }
    console.error('[ASK Transition] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
