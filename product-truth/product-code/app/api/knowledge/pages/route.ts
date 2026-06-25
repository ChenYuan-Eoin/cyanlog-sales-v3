// REQ: 知识库 - 页面管理 API
// PURPOSE: 创建知识库页面

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import {
  canUseKnowledgePage,
  fetchKnowledgePermissions,
  getKnowledgeAccessContext,
} from '@/lib/knowledge/access'

const PAGE_TYPES = new Set(['folder', 'doc', 'template', 'rule', 'case', 'qualification', 'reference'])

// POST /api/knowledge/pages - 创建知识库页面
export async function POST(req: NextRequest) {
  try {
    const currentUser = await requireAuth(req)
    const { orgId, assignments } = await getKnowledgeAccessContext(currentUser.id)

    const body = await req.json().catch(() => ({}))
    const { title, type = 'doc', parent_id = null, content } = body

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      return NextResponse.json({ error: '页面标题不能为空' }, { status: 400 })
    }

    if (typeof type !== 'string' || !PAGE_TYPES.has(type)) {
      return NextResponse.json({ error: '页面类型无效' }, { status: 400 })
    }

    let depth = 0
    let path: string | null = null
    if (parent_id) {
      const { data: parent } = await supabaseAdmin
        .from('knowledge_pages')
        .select('id, org_id, created_by, depth, path')
        .eq('id', parent_id)
        .eq('org_id', orgId)
        .eq('is_archived', false)
        .maybeSingle()

      if (!parent) {
        return NextResponse.json({ error: '父页面不存在' }, { status: 400 })
      }

      const permissions = await fetchKnowledgePermissions([parent.id])
      if (!canUseKnowledgePage(
        parent,
        permissions.get(parent.id) || [],
        { userId: currentUser.id, orgId, assignments },
        'edit'
      )) {
        return NextResponse.json({ error: '无权限在该父页面下创建内容' }, { status: 403 })
      }

      depth = (parent.depth || 0) + 1
      path = parent.path ? `${parent.path}/${parent.id}` : `/${parent.id}`
    }

    const { data, error } = await supabaseAdmin
      .from('knowledge_pages')
      .insert({
        org_id: orgId,
        title: title.trim(),
        type,
        parent_id,
        content: content || [],
        depth,
        path,
        created_by: currentUser.id,
      })
      .select('id')
      .single()

    if (error) {
      console.error('Create knowledge page error:', error)
      return NextResponse.json({ error: '创建页面失败' }, { status: 500 })
    }

    if (data?.id) {
      await supabaseAdmin
        .from('knowledge_page_permissions')
        .upsert({
          page_id: data.id,
          principal_type: 'user',
          principal_id: currentUser.id,
          permission: 'admin',
          granted_by: currentUser.id,
        }, { onConflict: 'page_id,principal_type,principal_id,permission' })
    }

    return NextResponse.json({
      success: true,
      data: { id: data?.id },
    })
  } catch (err) {
    console.error('POST knowledge pages error:', err)
    if (err instanceof Error && err.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
