// REQ: F005 - 当前报告 API
// PURPOSE: 获取合同最新报告

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthUser } from '@/lib/auth'

// ASK Item 类型定义
interface AskItem {
  id: string
  status: 'pending' | 'responded' | 'closed'
}

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

    // 查询当前最新报告
    const { data: report, error } = await supabaseAdmin
      .from('report_versions')
      .select(`
        id,
        contract_id,
        version,
        trigger_event,
        trigger_ask_id,
        no_ask_reason,
        no_ask_explanation,
        report_data,
        report_file_url,
        is_current,
        created_at
      `)
      .eq('contract_id', contractId)
      .eq('is_current', true)
      .single()

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('[Report Current] Error:', error)
      return NextResponse.json(
        { error: 'Failed to fetch current report' },
        { status: 500 }
      )
    }

    // 查询 ASK 统计
    const { data: asks, error: askError } = await supabaseAdmin
      .from('ask_items')
      .select('status')
      .eq('contract_id', contractId)

    if (askError) {
      console.error('[Report Current] ASK count error:', askError)
    }

    const total = asks?.length || 0
    const typedAsks = (asks || []) as AskItem[]
    const pending = typedAsks.filter((a) => a.status === 'pending').length
    const responded = typedAsks.filter((a) => a.status === 'responded').length
    const closed = typedAsks.filter((a) => a.status === 'closed').length

    // 如果没有报告，返回空数据
    if (!report) {
      return NextResponse.json({
        success: true,
        data: {
          contract_id: contractId,
          has_report: false,
          ask_summary: {
            total,
            pending,
            responded,
            closed,
          },
          can_export: pending === 0 && total > 0,
        },
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        contract_id: contractId,
        has_report: true,
        current_version: report.version,
        is_current: report.is_current,
        no_ask_reason: report.no_ask_reason,
        no_ask_explanation: report.no_ask_explanation,
        report_data: report.report_data,
        report_file_url: report.report_file_url,
        created_at: report.created_at,
        ask_summary: {
          total,
          pending,
          responded,
          closed,
        },
        can_export: pending === 0,
      },
    })
  } catch (error) {
    console.error('[Report Current] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
