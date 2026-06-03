// F016 技术文档新建页
// 路径：/knowledge/documents/new

'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { DOC_TYPES, DOC_TYPE_LABEL, type DocType } from '@/lib/tech-documents/types'

export default function NewTechDocumentPage() {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    const form = new FormData(e.currentTarget)
    const tagsRaw = String(form.get('tags') || '')
    const tags = tagsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    const payload = {
      title: String(form.get('title') || '').trim(),
      doc_type: String(form.get('doc_type') || 'PRODUCT_SPEC') as DocType,
      version: String(form.get('version') || 'v1.0.0').trim(),
      content: String(form.get('content') || '').trim() || undefined,
      file_url: String(form.get('file_url') || '').trim() || undefined,
      tags,
      is_published: form.get('is_published') === 'on',
    }
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null
    try {
      const res = await fetch('/api/tech-documents', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError(body.error || '创建失败')
        return
      }
      const data = await res.json()
      router.push(`/knowledge/documents/${data.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-6 lg:p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-900 mb-2">新建技术文档</h1>
      <p className="text-sm text-slate-500 mb-6">记录产品/技术/API/部署相关文档</p>

      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 mb-4">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>文档信息</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="文档标题" required>
              <Input name="title" required placeholder="如：报价中心 API v2 文档" />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="文档类型" required>
                <select
                  name="doc_type"
                  defaultValue="PRODUCT_SPEC"
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
                >
                  {DOC_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {DOC_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="版本号" required>
                <Input name="version" defaultValue="v1.0.0" pattern="^v\d+\.\d+\.\d+$" required />
              </Field>
              <Field label="附件 URL">
                <Input name="file_url" type="url" placeholder="https://..." />
              </Field>
              <Field label="标签（逗号分隔）">
                <Input name="tags" placeholder="API, v2, 报价" />
              </Field>
            </div>
            <Field label="是否发布">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="is_published" className="rounded" />
                <span className="text-slate-700">立即发布到知识库</span>
              </label>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>文档内容（Markdown）</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea name="content" rows={12} placeholder="# 标题&#10;&#10;## 章节 1&#10;..." />
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            取消
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? '创建中...' : '创建文档'}
          </Button>
        </div>
      </form>
    </div>
  )
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-slate-700 block mb-1.5">
        {label}
        {required && <span className="text-rose-500 ml-1">*</span>}
      </label>
      {children}
    </div>
  )
}
