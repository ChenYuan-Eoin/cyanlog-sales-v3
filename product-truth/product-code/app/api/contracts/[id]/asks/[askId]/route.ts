// REQ: F005 - ASK 详情 API
// PURPOSE: 获取单个 ASK 详情

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getAccessibleContract } from '@/lib/scoped-access'
import { firstRelatedRow, type OneOrMany } from '@/lib/ask/relations'
import { resolveCurrentReviewArtifactBinding } from '@/lib/contracts/current-review-binding'

// ASK关联用户类型 - 匹配数据库查询返回的结构
interface AskWithUser {
  id: string
  status: string
  initial_level: string
  question_text: string
  created_at: string
  updated_at: string
  ask_code?: string
  clause_ref?: string
  risk_name?: string
  question_type?: string
  required_roles?: string[]
  qualified_std?: string
  trigger_user_id?: string
  closed_reason?: string
  users?: OneOrMany<{
    name?: string
    email?: string
  }>
}

interface RouteParams {
  params: Promise<{ id: string; askId: string }>
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const resolvedParams = await params
    const { id: contractId, askId } = resolvedParams

    const user = await requireAuth(request)

    const { contract } = await getAccessibleContract(
      contractId,
      user.id,
      undefined,
      'id, current_version_id',
    )
    if (!contract) {
      return NextResponse.json(
        { error: 'Contract not found' },
        { status: 404 }
      )
    }
    const binding = await resolveCurrentReviewArtifactBinding({
      contractId,
      currentVersionId: typeof contract.current_version_id === 'string'
        ? contract.current_version_id
        : null,
    })
    if (!binding) {
      return NextResponse.json({ error: 'ASK not found' }, { status: 404 })
    }

    // 查询 ASK 详情
    const { data: ask, error } = await supabaseAdmin
      .from('ask_items')
      .select(`
        id,
        contract_id,
        ask_code,
        clause_ref,
        risk_name,
        initial_level,
        question_type,
        required_roles,
        question_text,
        qualified_std,
        status,
        trigger_user_id,
        closed_by,
        closed_reason,
        created_at,
        updated_at,
        ask_responses!ask_responses_ask_id_fkey (
          id,
          responder_id,
          responder_role,
          responder_name,
          response_text,
          attachments,
          created_at
        ),
        users:trigger_user_id (name, email)
      `)
      .eq('id', askId)
      .eq('contract_id', contractId)
      .eq('review_id', binding.reviewId)
      .eq('contract_version_id', binding.contractVersionId)
      .eq('binding_state', 'bound')
      .single()

    if (error) {
      console.error('[ASK Detail] Error:', error)
      return NextResponse.json(
        { error: 'ASK not found' },
        { status: 404 }
      )
    }

    const typedAsk = ask as AskWithUser
    const triggerUser = firstRelatedRow(typedAsk.users)

    return NextResponse.json({
      success: true,
      data: {
        ...typedAsk,
        users: triggerUser ? [triggerUser] : [],
        trigger_user_name: triggerUser?.name || triggerUser?.email,
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
    console.error('[ASK Detail] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
