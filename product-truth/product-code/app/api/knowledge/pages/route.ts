// REQ: 知识库 - 页面管理 API
// PURPOSE: 查询与创建知识库页面

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import {
  canUseKnowledgePage,
  fetchKnowledgePermissions,
  getKnowledgeAccessContext,
} from '@/lib/knowledge/access'
import { canManageOrg } from '@/lib/scoped-access'

const PAGE_TYPE_VALUES = ['folder', 'doc', 'template', 'rule', 'case', 'qualification', 'reference'] as const
const PAGE_TYPES = new Set<string>(PAGE_TYPE_VALUES)

const ListPagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  type: z.enum(PAGE_TYPE_VALUES).optional(),
  parent_id: z.string().uuid().optional(),
  q: z.string().trim().min(1).max(80).optional(),
})

export const dynamic = 'force-dynamic'

// GET /api/knowledge/pages - 查询知识库页面列表
export async function GET(req: NextRequest) {
  try {
    const currentUser = await requireAuth(req)
    const { orgId, assignments } = await getKnowledgeAccessContext(currentUser.id)
    const { searchParams } = new URL(req.url)
    const parsed = ListPagesQuerySchema.safeParse(Object.fromEntries(searchParams))

    if (!parsed.success) {
      return NextResponse.json({ error: '查询参数无效', code: 'INVALID_QUERY' }, { status: 400 })
    }

    const { limit, offset, type, parent_id, q } = parsed.data
    let query = supabaseAdmin
      .from('knowledge_pages')
      .select(
        'id, org_id, title, type, parent_id, depth, path, sort_order, is_published, is_archived, created_by, created_at, updated_at, metadata',
        { count: 'exact' }
      )
      .eq('org_id', orgId)
      .eq('is_archived', false)

    if (type) {
      query = query.eq('type', type)
    }

    if (parent_id) {
      query = query.eq('parent_id', parent_id)
    }

    if (q) {
      query = query.ilike('title', `%${q}%`)
    }

    const { data: pages, error, count } = await query
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('Get knowledge pages error:', error)
      return NextResponse.json({ error: '获取知识库页面失败' }, { status: 500 })
    }

    const pageRows = pages || []
    const canManageKnowledge = canManageOrg(assignments)
    const permissionMap = canManageKnowledge
      ? new Map()
      : await fetchKnowledgePermissions(pageRows.map((page) => page.id))

    const visiblePages = pageRows.filter((page) => {
      if (page.created_by === currentUser.id || canManageKnowledge) {
        return true
      }

      return canUseKnowledgePage(
        page,
        permissionMap.get(page.id) || [],
        { userId: currentUser.id, orgId, assignments },
        'view'
      )
    })

    const response = NextResponse.json({
      data: visiblePages,
      meta: {
        total: visiblePages.length === pageRows.length ? count ?? visiblePages.length : visiblePages.length,
        limit,
        offset,
      },
    })
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (err) {
    const authError = err instanceof Error && (err.name === 'AuthError' || err.message === 'Unauthorized')
    if (authError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('GET knowledge pages error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

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
