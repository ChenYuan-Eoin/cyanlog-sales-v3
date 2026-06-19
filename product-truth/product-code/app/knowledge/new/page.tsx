'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeftIcon, FileTextIcon, FolderIcon } from 'lucide-react'

const PAGE_TYPES = [
  { value: 'doc', label: '文档', icon: FileTextIcon },
  { value: 'folder', label: '文件夹', icon: FolderIcon },
]

export default function KnowledgeNewPage() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [type, setType] = useState('doc')
  const [creating, setCreating] = useState(false)

  const handleCreate = useCallback(async () => {
    if (!title.trim()) return
    setCreating(true)
    try {
      const token = localStorage.getItem('token')
      const res = await fetch('/api/knowledge/pages', {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: title.trim(),
          type,
          content: type === 'doc' ? [] : undefined,
        }),
      })

      if (res.ok) {
        const data = await res.json()
        router.push(`/knowledge/pages/${data.data?.id || data.id}`)
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error || '创建失败')
      }
    } catch {
      alert('网络错误，请重试')
    } finally {
      setCreating(false)
    }
  }, [title, type, router])

  return (
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/knowledge">
            <Button variant="ghost" size="icon">
              <ArrowLeftIcon className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">新建知识库页面</h1>
        </div>

        {/* Form */}
        <div className="bg-white rounded-lg border border-slate-200 p-6 space-y-6">
          {/* Type Selection */}
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">类型</label>
            <div className="flex gap-3">
              {PAGE_TYPES.map((t) => {
                const Icon = t.icon
                return (
                  <button
                    key={t.value}
                    onClick={() => setType(t.value)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border transition ${
                      type === t.value
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    <span className="text-sm">{t.label}</span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Title Input */}
          <div>
            <label className="text-sm font-medium text-slate-700 mb-2 block">标题</label>
            <Input
              placeholder="输入页面标题..."
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && title.trim()) {
                  void handleCreate()
                }
              }}
            />
          </div>

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-4 border-t">
            <Link href="/knowledge">
              <Button variant="outline">取消</Button>
            </Link>
            <Button
              onClick={handleCreate}
              disabled={!title.trim() || creating}
            >
              {creating ? '创建中...' : '创建'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
