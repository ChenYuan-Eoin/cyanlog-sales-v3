// GET /api/knowledge/pages/[id] - 获取知识库页面详情
// POST /api/knowledge/pages/[id] - 更新知识库页面

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'

// GET /api/knowledge/pages/:id
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
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
    const { data: permissions } = await supabaseAdmin
      .from('knowledge_page_permissions')
      .select('*')
      .eq('page_id', id)

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
        permissions: permissions || [],
        versions: versions || [],
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
    const orgId = await getDefaultOrgId(user.id)
    const { id } = await params
    const body = await req.json()

    // 获取当前版本
    const { data: currentPage } = await supabaseAdmin
      .from('knowledge_pages')
      .select('version, content')
      .eq('id', id)
      .single()

    if (!currentPage) {
      return NextResponse.json({ error: '页面不存在' }, { status: 404 })
    }

    // 更新页面
    const { data: updated, error } = await supabaseAdmin
      .from('knowledge_pages')
      .update({
        ...body,
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
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
        version: (currentPage.version || 0) + 1,
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
    const orgId = await getDefaultOrgId(user.id)
    const { id } = await params

    // 检查是否有子页面
    const { data: children } = await supabaseAdmin
      .from('knowledge_pages')
      .select('id')
      .eq('parent_id', id)
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
