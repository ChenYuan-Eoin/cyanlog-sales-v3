// GET /api/knowledge/pages/[id] - 获取知识库页面详情
// POST /api/knowledge/pages/[id] - 更新知识库页面

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import {
  canUseKnowledgePage,
  fetchKnowledgePermissions,
  getKnowledgeAccessContext,
} from '@/lib/knowledge/access'

const knowledgePageUpdateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  content: z.unknown().optional(),
  content_text: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  is_published: z.boolean().optional(),
  change_note: z.string().trim().min(1).optional(),
})

const UPDATABLE_FIELDS = new Set(['title', 'content', 'content_text', 'metadata', 'is_published'])

function pickUpdatePayload(body: z.infer<typeof knowledgePageUpdateSchema>, userId: string) {
  const payload: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(body)) {
    if (UPDATABLE_FIELDS.has(key)) {
      payload[key] = value
    }
  }
  return {
    ...payload,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  }
}

// GET /api/knowledge/pages/:id
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req)
    const { orgId, assignments } = await getKnowledgeAccessContext(user.id)
    const { id } = await params

    // 获取页面
    const { data: page, error } = await supabaseAdmin
      .from('knowledge_pages')
      .select('*, created_by_user:users!created_by(display_name), updated_by_user:users!updated_by(display_name)')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (error || !page) {
      return NextResponse.json({ error: '页面不存在' }, { status: 404 })
    }

    // 获取权限
    const permissionMap = await fetchKnowledgePermissions([id])
    const permissions = permissionMap.get(id) || []

    if (!canUseKnowledgePage(page, permissions, { userId: user.id, orgId, assignments }, 'view')) {
      return NextResponse.json({ error: '页面不存在' }, { status: 404 })
    }

    const canManagePage = canUseKnowledgePage(page, permissions, { userId: user.id, orgId, assignments }, 'admin')

    // 获取版本历史
    const { data: versions } = await supabaseAdmin
      .from('knowledge_page_versions')
      .select('*')
      .eq('page_id', id)
      .order('version', { ascending: false })
      .limit(10)

    return NextResponse.json({
      data: {
        ...page,
        permissions: canManagePage ? permissions : [],
        versions: canManagePage ? versions || [] : [],
      },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 })
    }
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}

// PATCH /api/knowledge/pages/:id
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req)
    const { orgId, assignments } = await getKnowledgeAccessContext(user.id)
    const { id } = await params
    const parsed = knowledgePageUpdateSchema.safeParse(await req.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: '页面参数无效', code: 'VALIDATION_ERROR' }, { status: 400 })
    }
    const body = parsed.data

    // 获取当前内容
    const { data: currentPage } = await supabaseAdmin
      .from('knowledge_pages')
      .select('id, org_id, created_by, content')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (!currentPage) {
      return NextResponse.json({ error: '页面不存在' }, { status: 404 })
    }

    const permissionMap = await fetchKnowledgePermissions([id])
    if (!canUseKnowledgePage(
      currentPage,
      permissionMap.get(id) || [],
      { userId: user.id, orgId, assignments },
      'edit'
    )) {
      return NextResponse.json({ error: '无权限编辑页面' }, { status: 403 })
    }

    const { data: latestVersion } = await supabaseAdmin
      .from('knowledge_page_versions')
      .select('version')
      .eq('page_id', id)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle()

    // 更新页面
    const { data: updated, error } = await supabaseAdmin
      .from('knowledge_pages')
      .update(pickUpdatePayload(body, user.id))
      .eq('id', id)
      .eq('org_id', orgId)
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: '更新失败' }, { status: 500 })
    }

    // 创建版本记录
    await supabaseAdmin
      .from('knowledge_page_versions')
      .insert({
        page_id: id,
        version: (latestVersion?.version || 0) + 1,
        content: body.content || currentPage.content,
        saved_by: user.id,
        change_note: body.change_note || '自动保存',
      })

    return NextResponse.json({ data: updated })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 })
    }
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}

// DELETE /api/knowledge/pages/:id
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req)
    const { orgId, assignments } = await getKnowledgeAccessContext(user.id)
    const { id } = await params

    const { data: page } = await supabaseAdmin
      .from('knowledge_pages')
      .select('id, org_id, created_by')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (!page) {
      return NextResponse.json({ error: '页面不存在' }, { status: 404 })
    }

    const permissionMap = await fetchKnowledgePermissions([id])
    if (!canUseKnowledgePage(
      page,
      permissionMap.get(id) || [],
      { userId: user.id, orgId, assignments },
      'admin'
    )) {
      return NextResponse.json({ error: '无权限删除页面' }, { status: 403 })
    }

    // 检查是否有子页面
    const { data: children } = await supabaseAdmin
      .from('knowledge_pages')
      .select('id')
      .eq('parent_id', id)
      .eq('org_id', orgId)
      .limit(1)

    if (children && children.length > 0) {
      return NextResponse.json({ error: '请先删除子页面' }, { status: 400 })
    }

    const { error } = await supabaseAdmin
      .from('knowledge_pages')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId)

    if (error) {
      return NextResponse.json({ error: '删除失败' }, { status: 500 })
    }

    return NextResponse.json({ message: '已删除' })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 })
    }
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}
