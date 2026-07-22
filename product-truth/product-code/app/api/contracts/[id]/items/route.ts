// GET /api/contracts/[id]/items - 获取合同标的明细

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req)
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const { id: contractId } = await params

    // 查询合同标的明细
    const { data: items, error } = await supabaseAdmin
      .from('contract_items')
      .select('*')
      .eq('contract_id', contractId)
      .order('sort_order', { ascending: true })

    if (error) {
      return NextResponse.json({ error: '查询失败' }, { status: 500 })
    }

    return NextResponse.json({ data: items || [] })
  } catch {
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
