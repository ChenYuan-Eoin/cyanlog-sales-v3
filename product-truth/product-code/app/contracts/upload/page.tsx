'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeftIcon, UploadIcon, FileTextIcon, AlertCircleIcon } from 'lucide-react'
import { error as toastError } from '@/lib/toast'

export default function ContractUploadPage() {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    if (selected) {
      setFile(selected)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const droppedFile = e.dataTransfer.files[0]
    if (droppedFile) {
      setFile(droppedFile)
    }
  }, [])

  const handleUpload = useCallback(async () => {
    if (!file) return
    setUploading(true)
    setErrorMsg(null)

    try {
      const token = localStorage.getItem('token')
      if (!token) {
        setErrorMsg('请先登录')
        toastError('请先登录')
        return
      }

      // Step 1: Create contract draft
      const createRes = await fetch('/api/contracts', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          party_b_name: file.name.replace(/\.[^/.]+$/, ''),
          contract_amount: 0,
        }),
      })

      if (!createRes.ok) {
        const err = await createRes.json().catch(() => ({ error: '创建合同草稿失败' }))
        setErrorMsg(err.error || '创建合同草稿失败')
        toastError(err.error || '创建合同草稿失败')
        return
      }

      const createData = await createRes.json()
      const contractId = createData.data?.contract_id || createData.data?.id

      if (!contractId) {
        setErrorMsg('创建合同草稿失败：未返回合同ID')
        toastError('创建合同草稿失败：未返回合同ID')
        return
      }

      // Step 2: Upload file
      const formData = new FormData()
      formData.append('file', file)

      const uploadRes = await fetch(`/api/contracts/${contractId}/upload`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      })

      if (!uploadRes.ok) {
        const err = await uploadRes.json().catch(() => ({ error: '文件上传失败' }))
        setErrorMsg(err.error || '文件上传失败')
        toastError(err.error || '文件上传失败')
        return
      }

      // Step 3: Redirect to review
      router.push(`/contracts/${contractId}/review`)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '上传过程中发生错误，请重试'
      setErrorMsg(errorMessage)
      toastError(errorMessage)
      console.error('Upload error:', err)
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

        {/* Error Alert */}
        {errorMsg && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircleIcon className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-red-700 font-medium">上传失败</p>
              <p className="text-sm text-red-600">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Upload Area */}
        <div className="bg-white rounded-lg border border-slate-200 p-8">
          <div
            className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors cursor-pointer
              ${dragOver ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-blue-400'}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              ref={inputRef}
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
              <FileTextIcon className="h-5 w-5 text-blue-500 shrink-0" />
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
