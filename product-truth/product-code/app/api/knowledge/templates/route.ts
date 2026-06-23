// GET /api/knowledge/templates - 获取标准合同模板列表
// 用于标准合同对照(P2-2)时选择模板

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'

export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)

    const { data: templates, error } = await supabaseAdmin
      .from('knowledge_pages')
      .select('id, title, type, depth, metadata, created_at, updated_at')
      .eq('org_id', orgId)
      .eq('type', 'template')
      .eq('is_archived', false)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })

    if (error) {
      console.error('Get templates error:', error)
      return NextResponse.json({ error: '获取模板失败' }, { status: 500 })
    }

    return NextResponse.json({ data: templates || [] })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 })
    }
    console.error('Get templates error:', error)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}
