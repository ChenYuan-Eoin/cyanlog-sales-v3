// REQ: F005 - ASK 详情 API
// PURPOSE: 获取单个 ASK 详情

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthUser } from '@/lib/auth'

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
  users?: {
    name?: string
    email?: string
  }[]
}

interface RouteParams {
  params: Promise<{ id: string; askId: string }> | { id: string; askId: string }
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const resolvedParams = await params
    const { id: contractId, askId } = resolvedParams

    // 获取当前用户
    const user = await getAuthUser(request)
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
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
        ask_responses (
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
      .single()

    if (error) {
      console.error('[ASK Detail] Error:', error)
      return NextResponse.json(
        { error: 'ASK not found' },
        { status: 404 }
      )
    }

    const typedAsk = ask as AskWithUser
    const triggerUser = typedAsk.users?.[0]

    return NextResponse.json({
      success: true,
      data: {
        ...typedAsk,
        trigger_user_name: triggerUser?.name || triggerUser?.email,
      },
    })
  } catch (error) {
    console.error('[ASK Detail] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
