// GET /api/knowledge/pages/[id]/permissions - 获取页面权限
// POST /api/knowledge/pages/[id]/permissions - 添加权限
// DELETE /api/knowledge/pages/[id]/permissions/[permId] - 删除权限

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import {
  canUseKnowledgePage,
  fetchKnowledgePermissions,
  getKnowledgeAccessContext,
  type KnowledgePermission,
} from '@/lib/knowledge/access'

const PRINCIPAL_TYPES = new Set(['user', 'role', 'org'])
const PERMISSIONS = new Set(['view', 'edit', 'admin'])

async function requirePageAdmin(userId: string, pageId: string) {
  const { orgId, assignments } = await getKnowledgeAccessContext(userId)
  const { data: page } = await supabaseAdmin
    .from('knowledge_pages')
    .select('id, org_id, created_by')
    .eq('id', pageId)
    .eq('org_id', orgId)
    .single()

  if (!page) {
    return { ok: false as const, status: 404, error: '页面不存在或无权限' }
  }

  const permissionMap = await fetchKnowledgePermissions([pageId])
  const permissions = permissionMap.get(pageId) || []
  if (!canUseKnowledgePage(page, permissions, { userId, orgId, assignments }, 'admin')) {
    return { ok: false as const, status: 403, error: '无权限管理页面权限' }
  }

  return { ok: true as const, permissions }
}

// 获取页面权限
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req)
    const { id } = await params

    const access = await requirePageAdmin(user.id, id)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
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
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req)
    const { id } = await params
    const body = await req.json()

    const access = await requirePageAdmin(user.id, id)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    if (
      !PRINCIPAL_TYPES.has(body.principal_type)
      || typeof body.principal_id !== 'string'
      || !PERMISSIONS.has(body.permission)
    ) {
      return NextResponse.json({ error: '权限参数无效' }, { status: 400 })
    }

    // 添加权限
    const { data, error } = await supabaseAdmin
      .from('knowledge_page_permissions')
      .insert({
        page_id: id,
        principal_type: body.principal_type,
        principal_id: body.principal_id,
        permission: body.permission as KnowledgePermission,
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
  { params }: { params: Promise<{ id: string; permId: string }> }
) {
  try {
    const user = await requireAuth(req)
    const { id, permId } = await params

    const access = await requirePageAdmin(user.id, id)
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status })
    }

    // 删除权限
    const { error } = await supabaseAdmin
      .from('knowledge_page_permissions')
      .delete()
      .eq('id', permId)
      .eq('page_id', id)

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
