// GET /api/knowledge/tree - 获取知识库树状结构
// 返回树形数据，包含层级和展开状态

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'

interface KnowledgePage {
  id: string
  title: string
  type: 'folder' | 'doc' | 'template' | 'rule' | 'case' | 'qualification' | 'reference'
  parent_id: string | null
  depth: number
  path: string
  sort_order: number
  is_published: boolean
  is_archived: boolean
  created_by: string
  created_at: string
  updated_at: string
  // 聚合子节点
  children?: KnowledgePage[]
}

interface TreeNode extends KnowledgePage {
  children: TreeNode[]
}

function buildTree(pages: KnowledgePage[]): TreeNode[] {
  const nodeMap = new Map<string, TreeNode>()

  // 初始化所有节点
  pages.forEach(page => {
    nodeMap.set(page.id, { ...page, children: [] })
  })

  const roots: TreeNode[] = []

  // 构建树
  pages.forEach(page => {
    const node = nodeMap.get(page.id)!
    if (page.parent_id && nodeMap.has(page.parent_id)) {
      const parent = nodeMap.get(page.parent_id)!
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  })

  // 按 sort_order 排序
  function sortTree(nodes: TreeNode[]) {
    nodes.sort((a, b) => a.sort_order - b.sort_order)
    nodes.forEach(node => sortTree(node.children))
  }
  sortTree(roots)

  return roots
}

// GET /api/knowledge/tree
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth(req)
    const orgId = await getDefaultOrgId(user.id)

    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') as KnowledgePage['type'] | null
    const depth = searchParams.get('depth') ? parseInt(searchParams.get('depth')!, 10) : null

    let query = supabaseAdmin
      .from('knowledge_pages')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_archived', false)
      .order('depth', { ascending: true })
      .order('sort_order', { ascending: true })

    if (type) {
      query = query.eq('type', type)
    }

    if (depth !== null) {
      query = query.lte('depth', depth)
    }

    const { data: pages, error } = await query

    if (error) {
      console.error('Get knowledge tree error:', error)
      return NextResponse.json({ error: '获取知识库失败' }, { status: 500 })
    }

    const tree = buildTree(pages || [])

    return NextResponse.json({
      data: tree,
      meta: { total: pages?.length || 0 },
    })
  } catch (error) {
    const authError = error instanceof Error && error.name === 'AuthError'
    if (authError) {
      return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 })
    }
    console.error('Get knowledge tree error:', error)
    return NextResponse.json({ error: '服务器内部错误' }, { status: 500 })
  }
}
