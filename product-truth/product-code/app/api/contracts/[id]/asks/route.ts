// REQ: F005 - ASK 清单列表 API
// PURPOSE: 获取合同的 ASK 清单

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getAccessibleContract } from '@/lib/scoped-access'
import { canAccessAskByRoles } from '@/lib/ask/permissions'
import { firstRelatedRow, type OneOrMany } from '@/lib/ask/relations'

// ASK Item 类型定义 - 匹配数据库查询返回的结构
interface AskItem {
  id: string
  status: 'pending' | 'responded' | 'closed'
  initial_level: 'red' | 'yellow' | 'green' | 'white'
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
  ask_responses?: OneOrMany<AskResponse>
  response?: AskResponse | null
}

interface AskResponse {
  id: string
  responder_id: string
  responder_role: string
  responder_name: string
  response_text: string
  attachments: unknown[]
  created_at: string
}

interface RouteParams {
  params: Promise<{ id: string }>
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const resolvedParams = await params
    const { id: contractId } = resolvedParams

    const user = await requireAuth(request)

    // 验证合同权限
    const access = await getAccessibleContract(contractId, user.id, undefined, 'id, org_id')
    const { contract } = access

    if (!contract) {
      return NextResponse.json(
        { error: 'Contract not found' },
        { status: 404 }
      )
    }

    // 获取 ASK 列表
    const { data: asks, error } = await supabaseAdmin
      .from('ask_items')
      .select(`
        id,
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
        )
      `)
      .eq('contract_id', contractId)
      .order('created_at', { ascending: true })

    if (error) {
      console.error('[ASK List] Error:', error)
      return NextResponse.json(
        { error: 'Failed to fetch ASK items' },
        { status: 500 }
      )
    }

    const visibleItems = ((asks || []) as AskItem[])
      .filter((ask) => canAccessAskByRoles(ask.required_roles, access.assignments))
      .map((ask) => {
        const { ask_responses, ...item } = ask
        return {
          ...item,
          response: firstRelatedRow(ask_responses),
        }
      })

    // 统计
    const total = visibleItems.length
    const pending = visibleItems.filter((a: AskItem) => a.status === 'pending').length
    const responded = visibleItems.filter((a: AskItem) => a.status === 'responded').length
    const closed = visibleItems.filter((a: AskItem) => a.status === 'closed').length

    // 按风险等级统计
    const redCount = visibleItems.filter((a: AskItem) => a.initial_level === 'red').length
    const yellowCount = visibleItems.filter((a: AskItem) => a.initial_level === 'yellow').length
    const greenCount = visibleItems.filter((a: AskItem) => a.initial_level === 'green').length

    return NextResponse.json({
      success: true,
      data: {
        contract_id: contractId,
        items: visibleItems,
        summary: {
          total,
          pending,
          responded,
          closed,
        },
        risk_summary: {
          red: redCount,
          yellow: yellowCount,
          green: greenCount,
        },
        // 硬关单检查
        can_export: pending === 0,
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
    console.error('[ASK List] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
