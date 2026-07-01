// REQ: F005 - 报告版本列表 API
// PURPOSE: 获取合同报告版本历史

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getAuthUser } from '@/lib/auth'
import { firstRelatedRow, type OneOrMany } from '@/lib/ask/relations'

// 报告版本类型定义
interface ReportVersion {
  id: string
  version: number
  trigger_event: string
  trigger_ask_id?: string
  no_ask_reason?: string
  created_at: string
  is_current: boolean
  users?: OneOrMany<{
    name: string
  }>
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

    // 获取当前用户
    const user = await getAuthUser(request)
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // 查询所有版本
    const { data: versions, error } = await supabaseAdmin
      .from('report_versions')
      .select(`
        id,
        version,
        trigger_event,
        trigger_ask_id,
        no_ask_reason,
        created_at,
        is_current,
        users:trigger_user_id (name)
      `)
      .eq('contract_id', contractId)
      .order('version', { ascending: false })

    if (error) {
      console.error('[Report Versions] Error:', error)
      return NextResponse.json(
        { error: 'Failed to fetch report versions' },
        { status: 500 }
      )
    }

    // 格式化结果
    const formattedVersions = (versions as ReportVersion[] | null)?.map((v) => {
      const triggerUser = firstRelatedRow(v.users)
      return {
        id: v.id,
        version: v.version,
        trigger_event: v.trigger_event,
        trigger_ask_code: v.trigger_ask_id ? `ASK-${v.trigger_ask_id.slice(0, 8)}` : null,
        trigger_user_name: triggerUser?.name || 'System',
        no_ask_reason: v.no_ask_reason,
        created_at: v.created_at,
        is_current: v.is_current,
      }
    }) || []

    return NextResponse.json({
      success: true,
      data: {
        contract_id: contractId,
        versions: formattedVersions,
        total_versions: formattedVersions.length,
      },
    })
  } catch (error) {
    console.error('[Report Versions] Unexpected error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
