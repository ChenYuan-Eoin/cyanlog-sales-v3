// GET /api/knowledge/pages/[id]/permissions - 获取页面权限
// POST /api/knowledge/pages/[id]/permissions - 添加权限
// DELETE /api/knowledge/pages/[id]/permissions/[permId] - 删除权限

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'

// 获取页面权限
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { id } = params

    // 检查页面是否属于当前组织
    const { data: page } = await supabaseAdmin
      .from('knowledge_pages')
      .select('id')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (!page) {
      return NextResponse.json({ error: '页面不存在或无权限' }, { status: 404 })
    }

    // 获取权限
    const { data: permissions, error } = await supabaseAdmin
      .from('knowledge_page_permissions')
      .select('*, users:principal_id(display_name, email)')
      .eq('page_id', id)

    if (error) {
      return NextResponse.json({ error: '获取权限失败' }, { status: 500 })
    }

    return NextResponse.json({ data: permissions })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 })
    }
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}

// 添加权限
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { id } = params
    const body = await req.json()

    // 检查页面是否属于当前组织
    const { data: page } = await supabaseAdmin
      .from('knowledge_pages')
      .select('id')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (!page) {
      return NextResponse.json({ error: '页面不存在或无权限' }, { status: 404 })
    }

    // 添加权限
    const { data, error } = await supabaseAdmin
      .from('knowledge_page_permissions')
      .insert({
        page_id: id,
        principal_type: body.principal_type,
        principal_id: body.principal_id,
        permission: body.permission,
        granted_by: user.id,
      })
      .select()
      .single()

    if (error) {
      return NextResponse.json({ error: '添加权限失败' }, { status: 500 })
    }

    return NextResponse.json({ data })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 })
    }
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}

// 删除权限
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string; permId: string } }
) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)
    const { id, permId } = params

    // 检查页面是否属于当前组织
    const { data: page } = await supabaseAdmin
      .from('knowledge_pages')
      .select('id')
      .eq('id', id)
      .eq('org_id', orgId)
      .single()

    if (!page) {
      return NextResponse.json({ error: '页面不存在或无权限' }, { status: 404 })
    }

    // 删除权限
    const { error } = await supabaseAdmin
      .from('knowledge_page_permissions')
      .delete()
      .eq('id', permId)

    if (error) {
      return NextResponse.json({ error: '删除权限失败' }, { status: 500 })
    }

    return NextResponse.json({ message: '权限已删除' })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 })
    }
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}
