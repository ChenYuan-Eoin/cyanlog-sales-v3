'use client'

import { FormEvent, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertCircleIcon, CheckCircleIcon, FileTextIcon, Loader2Icon, UploadIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { deleteBrowserCache, scopedCacheKey } from '@/lib/browser-cache'

const ACCEPTED_TYPES = '.pdf,.doc,.docx,.txt,text/plain,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

type UploadResult = {
  id: string
  fileName: string
  confidence: number
  keyInfo?: {
    tenderName?: string
    tenderNo?: string
    aiRuntime?: {
      provider?: string
      model?: string
      transport?: string
      coverage_ratio?: number
      degraded?: boolean
      model_invocation_id?: string
    }
  }
}

export default function TenderUploadClient() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<UploadResult | null>(null)

  const fileSummary = useMemo(() => {
    if (!file) return null
    return `${file.name} · ${formatBytes(file.size)}`
  }, [file])

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file || submitting) return

    const token = localStorage.getItem('token')
    if (!token) {
      router.push('/login')
      return
    }

    setSubmitting(true)
    setError('')
    setResult(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/tenders/ocr', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: formData,
      })
      const body = await response.json().catch(() => ({}))

      if (!response.ok || !body?.success) {
        throw new Error(body?.error?.message || '解析失败')
      }

      const data = body.data as UploadResult
      deleteBrowserCache(scopedCacheKey(token, 'tenders:list'))
      setResult(data)
      router.push(`/tenders/${data.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6 lg:p-8">
      <div className="mb-6">
        <Link href="/tenders" className="text-sm font-medium text-slate-500 hover:text-slate-900">
          返回标书中心
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-slate-900 lg:text-3xl">上传招标文件</h1>
        <p className="mt-1 text-sm text-slate-500">
          PDF、Word、长文本会进入云端分块解析，并保留模型调用证据。
        </p>
      </div>

      <form onSubmit={handleSubmit} className="rounded-lg border bg-white">
        <label className="block cursor-pointer p-6">
          <input
            type="file"
            accept={ACCEPTED_TYPES}
            className="sr-only"
            disabled={submitting}
            onChange={(event) => {
              const nextFile = event.target.files?.[0] || null
              setFile(nextFile)
              setError('')
              setResult(null)
            }}
          />
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 px-6 py-12 text-center transition hover:border-blue-400 hover:bg-blue-50/40">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              {file ? <FileTextIcon className="h-6 w-6" /> : <UploadIcon className="h-6 w-6" />}
            </div>
            <div className="mt-4 text-base font-semibold text-slate-900">
              {fileSummary || '选择招标文件'}
            </div>
            <div className="mt-1 text-sm text-slate-500">
              支持 PDF、DOC、DOCX、TXT；扫描件 PDF 仍需要 OCR/视觉模型补齐。
            </div>
          </div>
        </label>

        <div className="flex flex-col gap-3 border-t px-6 py-4 md:flex-row md:items-center md:justify-between">
          <div className="min-h-5 text-sm">
            {error ? (
              <span className="inline-flex items-center gap-2 text-red-600">
                <AlertCircleIcon className="h-4 w-4" />
                {error}
              </span>
            ) : result ? (
              <span className="inline-flex items-center gap-2 text-emerald-700">
                <CheckCircleIcon className="h-4 w-4" />
                已完成解析，正在打开结果
              </span>
            ) : (
              <span className="text-slate-500">上传后生成结构化结果和 AI 解析证据。</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Link href="/tenders" prefetch={false}>
              <Button type="button" variant="outline" disabled={submitting}>
                取消
              </Button>
            </Link>
            <Button type="submit" disabled={!file || submitting}>
              {submitting ? (
                <>
                  <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                  解析中
                </>
              ) : (
                <>
                  <UploadIcon className="mr-2 h-4 w-4" />
                  开始解析
                </>
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}
