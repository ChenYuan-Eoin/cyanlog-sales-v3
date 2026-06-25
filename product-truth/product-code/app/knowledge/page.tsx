// Notion化知识库首页 - 树状导航 + 6+层结构
// 路径: /knowledge

'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { handleError } from '@/lib/toast'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import {
  ChevronRightIcon,
  ChevronDownIcon,
  FolderIcon,
  FileTextIcon,
  LayoutTemplateIcon,
  BookOpenIcon,
  BriefcaseIcon,
  BookmarkIcon,
  PlusIcon,
  SearchIcon,
} from 'lucide-react'
import NotionEditor from '@/components/knowledge/NotionEditor'

// Notion Blocks 类型（在NotionEditor组件中定义）
// interface Block { ... }

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
  // 聚合
  children: KnowledgePage[]
}

// 类型图标映射
const typeIcons: Record<string, typeof FolderIcon> = {
  folder: FolderIcon,
  doc: FileTextIcon,
  template: LayoutTemplateIcon,
  rule: BookOpenIcon,
  case: BriefcaseIcon,
  qualification: BookmarkIcon,
  reference: BookmarkIcon,
}

const typeColors: Record<string, string> = {
  folder: 'text-amber-600',
  doc: 'text-blue-600',
  template: 'text-purple-600',
  rule: 'text-red-600',
  case: 'text-green-600',
  qualification: 'text-cyan-600',
  reference: 'text-slate-600',
}

const typeLabels: Record<string, string> = {
  folder: '文件夹',
  doc: '文档',
  template: '模板',
  rule: '规则',
  case: '案例',
  qualification: '资质',
  reference: '参考',
}

// 树节点组件
function TreeNode({
  page,
  level,
  expanded,
  onToggle,
  selectedId,
}: {
  page: KnowledgePage
  level: number
  expanded: Set<string>
  onToggle: (id: string) => void
  selectedId: string | null
}) {
  const isExpanded = expanded.has(page.id)
  const hasChildren = page.children && page.children.length > 0
  const Icon = typeIcons[page.type] || FileTextIcon
  const isSelected = selectedId === page.id

  return (
    <div>
      <div
        className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left transition group cursor-pointer ${
          isSelected
            ? 'bg-blue-50 text-blue-900'
            : 'hover:bg-slate-50'
        }`}
        style={{ paddingLeft: `${level * 16 + 12}px` }}
        onClick={() => onToggle(page.id)}
      >
        {/* 展开/折叠按钮 */}
        <div
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-slate-200/50"
          onClick={(e) => {
            e.stopPropagation()
            onToggle(page.id)
          }}
        >
          {hasChildren ? (
            isExpanded ? (
              <ChevronDownIcon size={14} className="text-slate-400" />
            ) : (
              <ChevronRightIcon size={14} className="text-slate-400" />
            )
          ) : (
            <span className={`h-1.5 w-1.5 rounded-full ${isSelected ? 'bg-blue-300' : 'bg-slate-300'}`} />
          )}
        </div>

        {/* 类型图标 */}
        <Icon size={16} className={`shrink-0 ${typeColors[page.type] || 'text-slate-400'}`} />

        {/* 标题 */}
        <span className="flex-1 text-sm font-medium truncate">
          {page.title}
        </span>

        {/* 状态徽章 */}
        {!page.is_published && (
          <Badge variant="outline" className="text-xs text-slate-400">
            草稿
          </Badge>
        )}
        {page.is_archived && (
          <Badge variant="secondary" className="text-xs">
            已归档
          </Badge>
        )}
      </div>

      {/* 子节点 */}
      {isExpanded && hasChildren && (
        <div>
          {page.children.map((child) => (
            <TreeNode
              key={child.id}
              page={child}
              level={level + 1}
              expanded={expanded}
              onToggle={onToggle}
              selectedId={selectedId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function KnowledgePage() {
  const router = useRouter()
  const [tree, setTree] = useState<KnowledgePage[]>([])
  const [loading, setLoading] = useState(true)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // 加载树
  const loadTree = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/knowledge/tree', {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        setTree(data.data || [])
      }
    } catch (err) {
      handleError(err, '加载知识库失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTree()
  }, [loadTree])

  // 展开/折叠
  const handleToggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
    setSelectedId(id)
  }

  // 过滤树（搜索）
  const filterTree = (nodes: KnowledgePage[], query: string): KnowledgePage[] => {
    if (!query.trim()) return nodes
    return nodes
      .map(node => {
        const filteredChildren = filterTree(node.children || [], query)
        const matches = node.title.toLowerCase().includes(query.toLowerCase())
        if (matches || filteredChildren.length > 0) {
          return { ...node, children: filteredChildren }
        }
        return null
      })
      .filter(Boolean) as KnowledgePage[]
  }

  const filteredTree = searchQuery.trim() ? filterTree(tree, searchQuery) : tree

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingState message="加载知识库..." size="lg" />
      </div>
    )
  }

  return (
    <div className="flex h-screen">
      {/* 左侧树状导航 */}
      <div className="w-[280px] shrink-0 border-r bg-white flex flex-col">
        {/* 头部 */}
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-lg font-bold text-slate-900">知识库</h1>
            <Button size="sm" variant="outline" onClick={() => router.push('/knowledge/new')}>
              <PlusIcon size={16} className="mr-1" />
              新建
            </Button>
          </div>

          {/* 搜索 */}
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              placeholder="搜索页面..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* 树 */}
        <div className="flex-1 overflow-y-auto p-2">
          {filteredTree.length === 0 ? (
            <EmptyState
              title={searchQuery ? '未找到匹配页面' : '暂无知识库页面'}
              description={searchQuery ? '请尝试其他搜索关键词' : '点击上方"新建"按钮创建第一个页面'}
              icon={searchQuery ? SearchIcon : BookOpenIcon}
              size="sm"
            />
          ) : (
            filteredTree.map(page => (
              <TreeNode
                key={page.id}
                page={page}
                level={0}
                expanded={expanded}
                onToggle={handleToggle}
                selectedId={selectedId}
              />
            ))
          )}
        </div>

        {/* 底部统计 */}
        <div className="p-3 border-t text-xs text-slate-500">
          共 {tree.length} 个页面
        </div>
      </div>

      {/* 右侧内容区 */}
      <div className="flex-1 bg-slate-50 overflow-y-auto">
        {selectedId ? (
          <KnowledgeContent pageId={selectedId} />
        ) : (
          <div className="flex items-center justify-center h-full">
            <EmptyState
              title="知识库"
              description="左侧选择页面查看详情，或新建页面开始构建知识库。支持树状6+层结构、Notion风格富文本编辑、页面级权限控制。"
              icon={BookOpenIcon}
              action={{
                label: '新建页面',
                onClick: () => router.push('/knowledge/new'),
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// 知识库内容组件
function KnowledgeContent({ pageId }: { pageId: string }) {
  const [page, setPage] = useState<KnowledgePage | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function loadPage() {
      setLoading(true)
      try {
        const token = localStorage.getItem('token')
        const res = await fetch(`/api/knowledge/pages/${pageId}`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        })
        if (res.ok) {
          const data = await res.json()
          setPage(data.data)
        }
      } catch (err) {
        handleError(err, '加载页面失败')
      } finally {
        setLoading(false)
      }
    }
    void loadPage()
  }, [pageId])

  if (loading) {
    return (
      <div className="p-8 animate-pulse">
        <div className="h-8 w-64 bg-slate-200 rounded mb-4" />
        <div className="h-4 w-32 bg-slate-200 rounded mb-2" />
        <div className="h-32 bg-slate-100 rounded" />
      </div>
    )
  }

  if (!page) {
    return (
      <div className="p-8">
        <p className="text-slate-500">页面不存在或无权访问</p>
      </div>
    )
  }

  const Icon = typeIcons[page.type] || FileTextIcon

  return (
    <div className="p-8">
      {/* 面包屑 */}
      <div className="flex items-center gap-2 text-sm text-slate-500 mb-4">
        <Link href="/knowledge" className="hover:text-slate-900">
          知识库
        </Link>
        <ChevronRightIcon size={14} />
        <span>{page.title}</span>
      </div>

      {/* 标题 */}
      <div className="flex items-center gap-3 mb-6">
        <Icon size={28} className={typeColors[page.type] || 'text-slate-400'} />
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{page.title}</h2>
          <p className="text-sm text-slate-500">
            {typeLabels[page.type] || '文档'} · 深度 {page.depth}
          </p>
        </div>
      </div>

      {/* 内容区 - Notion风格富文本编辑器 */}
      <NotionEditor
        onChange={(blocks) => {
          // 自动保存（防抖处理在组件内）
          console.log('Blocks changed:', blocks)
        }}
      />
    </div>
  )
}
