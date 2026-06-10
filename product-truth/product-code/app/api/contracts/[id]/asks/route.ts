// REQ: F005 - ASK 清单列表 API
// PURPOSE: 获取合同的 ASK 清单

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthUser } from '@/lib/auth'

interface RouteParams {
  params: Promise<{ id: string }> | { id: string }
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
) {
  try {
    const resolvedParams = await params
    const { id: contractId } = resolvedParams

    // 获取当前用户
    const user = await getAuthUser(request)
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // 验证合同权限
    const { data: contract, error: contractError } = await supabaseAdmin
      .from('contracts')
      .select('id, org_id')
      .eq('id', contractId)
      .single()

    if (contractError || !contract) {
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
        ask_responses (
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

    /* eslint-disable @typescript-eslint/no-explicit-any */
    // 统计
    const total = asks?.length || 0
    const pending = asks?.filter((a: any) => a.status === 'pending').length || 0
    const responded = asks?.filter((a: any) => a.status === 'responded').length || 0
    const closed = asks?.filter((a: any) => a.status === 'closed').length || 0

    // 按风险等级统计
    const redCount = asks?.filter((a: any) => a.initial_level === 'red').length || 0
    const yellowCount = asks?.filter((a: any) => a.initial_level === 'yellow').length || 0
    const greenCount = asks?.filter((a: any) => a.initial_level === 'green').length || 0
    /* eslint-enable @typescript-eslint/no-explicit-any */

    return NextResponse.json({
      success: true,
      data: {
        contract_id: contractId,
        items: asks || [],
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
    console.error('[ASK List] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
