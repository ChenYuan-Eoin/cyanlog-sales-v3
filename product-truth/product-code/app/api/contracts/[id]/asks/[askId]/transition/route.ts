// REQ: F005 - ASK 状态流转 API
// PURPOSE: 关闭/重开 ASK（法务权限）

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import {
  getAccessibleContract,
  getOrgRoleCodes,
} from '@/lib/scoped-access'
import { errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { canCloseOrReopenAsk } from '@/lib/ask/permissions'
import { resolveCurrentReviewArtifactBinding } from '@/lib/contracts/current-review-binding'

const transitionSchema = z.object({
  action: z.enum(['close', 'reopen']),
  reason: z.string().trim().max(1000, '原因不能超过 1000 字').optional(),
  closed_reason: z.string().trim().max(1000, '原因不能超过 1000 字').optional(),
}).superRefine((data, context) => {
  const reason = data.reason || data.closed_reason
  if (data.action === 'close' && !reason?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['reason'],
      message: '关闭 ASK 必须填写原因',
    })
  }
})

interface RouteParams {
  params: Promise<{ id: string; askId: string }>
}

export async function POST(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const resolvedParams = await params
    const { id: contractId, askId } = resolvedParams

    const user = await requireAuth(request)

    const access = await getAccessibleContract(
      contractId,
      user.id,
      undefined,
      'id, current_version_id',
    )
    if (!access.contract) {
      return NextResponse.json(
        { error: 'Contract not found' },
        { status: 404 }
      )
    }
    const binding = await resolveCurrentReviewArtifactBinding({
      contractId,
      currentVersionId: typeof access.contract.current_version_id === 'string'
        ? access.contract.current_version_id
        : null,
      mode: 'write',
    })
    if (!binding) {
      return NextResponse.json({ error: 'ASK not found' }, { status: 404 })
    }

    if (!canCloseOrReopenAsk(access.assignments, access.orgId)) {
      return errorResponse(createApiError('FORBIDDEN', '当前角色不能关闭或重开 ASK'))
    }

    const parsed = transitionSchema.safeParse(await request.json().catch(() => ({})))
    if (!parsed.success) {
      return errorResponse(
        createApiError('VALIDATION_ERROR', 'ASK 状态流转参数不正确', {
          fieldErrors: parsed.error.flatten().fieldErrors,
        })
      )
    }
    const { action } = parsed.data
    const reason = parsed.data.reason || parsed.data.closed_reason || ''

    // 获取 ASK 详情
    const { data: ask, error: askError } = await supabaseAdmin
      .from('ask_items')
      .select('id, contract_id, status, response_id')
      .eq('id', askId)
      .eq('contract_id', contractId)
      .eq('review_id', binding.reviewId)
      .eq('contract_version_id', binding.contractVersionId)
      .eq('binding_state', 'bound')
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
        .eq('review_id', binding.reviewId)

      if (updateError) {
        return errorResponse(createApiError('DB_ERROR', '关闭 ASK 失败'))
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
          response_id: null,
          closed_by: null,
          closed_reason: null,
          updated_at: now,
        })
        .eq('id', askId)
        .eq('contract_id', contractId)
        .eq('review_id', binding.reviewId)

      if (updateError) {
        return errorResponse(createApiError('DB_ERROR', '重开 ASK 失败'))
      }

      if (ask.response_id) {
        const { error: deleteResponseError } = await supabaseAdmin
          .from('ask_responses')
          .delete()
          .eq('ask_id', askId)

        if (deleteResponseError) {
          return errorResponse(createApiError('DB_ERROR', '清理旧 ASK 回应失败'))
        }
      }
    }

    // 记录审计日志
    const { error: auditError } = await supabaseAdmin
      .from('ask_audit_logs')
      .insert({
        ask_id: askId,
        contract_id: ask.contract_id,
        actor_id: user.id,
        actor_role: getOrgRoleCodes(access.assignments, access.orgId)[0] || 'unknown',
        event_type: eventType,
        from_status: fromStatus,
        to_status: toStatus,
        payload: {
          reason: reason || null,
        },
      })

    void auditError

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
      return errorResponse(createApiError('UNAUTHORIZED'))
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
