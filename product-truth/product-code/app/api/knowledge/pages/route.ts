// REQ: 知识库 - 页面管理 API
// PURPOSE: 创建知识库页面

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'

// POST /api/knowledge/pages - 创建知识库页面
export async function POST(req: NextRequest) {
  try {
    const currentUser = await requireAuth(req)
    const orgId = await getDefaultOrgId(currentUser.id)

    const body = await req.json()
    const { title, type = 'doc', parent_id = null, content } = body

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: '页面标题不能为空' }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
      .from('knowledge_pages')
      .insert({
        org_id: orgId,
        title: title.trim(),
        type,
        parent_id,
        content: content || (type === 'doc' ? { blocks: [] } : null),
        created_by: currentUser.id,
        status: 'active',
      })
      .select('id')
      .single()

    if (error) {
      console.error('Create knowledge page error:', error)
      return NextResponse.json({ error: '创建页面失败' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      id: data?.id,
    })
  } catch (err) {
    console.error('POST knowledge pages error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
