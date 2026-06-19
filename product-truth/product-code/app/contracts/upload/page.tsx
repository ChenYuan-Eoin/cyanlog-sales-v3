'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeftIcon, UploadIcon, FileTextIcon } from 'lucide-react'

export default function ContractUploadPage() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) {
      setFile(selected)
    }
  }, [])

  const handleUpload = useCallback(async () => {
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const token = localStorage.getItem('token')
      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      })

      if (res.ok) {
        const data = await res.json()
        router.push(`/contracts/${data.id}`)
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error || '上传失败')
      }
    } catch {
      alert('网络错误，请重试')
    } finally {
      setUploading(false)
    }
  }, [file, router])

  return (
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/contracts">
            <Button variant="ghost" size="icon">
              <ArrowLeftIcon className="h-4 w-4" />
            </Button>
          </Link>
          <h1 className="text-xl font-bold">上传合同</h1>
        </div>

        {/* Upload Area */}
        <div className="bg-white rounded-lg border border-slate-200 p-8">
          <div
            className="border-2 border-dashed border-slate-300 rounded-lg p-12 text-center hover:border-blue-400 transition-colors cursor-pointer"
            onClick={() => document.getElementById('file-input')?.click()}
          >
            <input
              id="file-input"
              type="file"
              accept=".doc,.docx,.pdf"
              className="hidden"
              onChange={handleFileChange}
            />
            <UploadIcon className="h-12 w-12 text-slate-400 mx-auto mb-4" />
            <p className="text-sm text-slate-600 mb-2">
              {file ? file.name : '点击上传或拖拽文件到此处'}
            </p>
            <p className="text-xs text-slate-400">支持 DOC、DOCX、PDF 格式</p>
          </div>

          {file && (
            <div className="flex items-center gap-3 mt-6 p-3 bg-slate-50 rounded-lg">
              <FileTextIcon className="h-5 w-5 text-blue-500" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{file.name}</p>
                <p className="text-xs text-slate-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
              <Button
                onClick={handleUpload}
                disabled={uploading}
              >
                {uploading ? '上传中...' : '开始上传'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
