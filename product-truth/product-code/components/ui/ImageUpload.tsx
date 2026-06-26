'use client'

import { useCallback, useState } from 'react'
import { UploadIcon, CloseIcon, LoaderIcon } from '@/components/icons'

interface ImageUploadProps {
  value: string
  onChange: (url: string) => void
  folder?: 'logos' | 'favicons' | 'avatars'
  accept?: string
  placeholder?: string
  maxSizeMB?: number
  /** 是否保持正方形比例（用于favicon） */
  square?: boolean
  /** 预览高度（像素） */
  previewHeight?: number
  /** 是否显示 URL 录入框 */
  showUrlInput?: boolean
}

export function ImageUpload({
  value,
  onChange,
  folder = 'logos',
  accept = 'image/png,image/jpeg,image/svg+xml,image/webp',
  placeholder = '点击或拖拽上传图片',
  maxSizeMB = 2,
  square = false,
  previewHeight = 64,
  showUrlInput = true,
}: ImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  const handleFileChange = useCallback(async (file: File | null) => {
    if (!file) return

    setError(null)
    const maxBytes = maxSizeMB * 1024 * 1024
    if (file.size > maxBytes) {
      setError(`图片大小不能超过 ${maxSizeMB}MB`)
      return
    }

    setIsUploading(true)

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('folder', folder)

      const token = localStorage.getItem('token')

      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: token ? {
          Authorization: `Bearer ${token}`,
        } : undefined,
        body: formData,
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || `上传失败 (${response.status})`)
      }

      const data = await response.json()
      onChange(data.url)
    } catch (err) {
      const message = err instanceof Error ? err.message : '上传失败'
      setError(message)
    } finally {
      setIsUploading(false)
    }
  }, [folder, maxSizeMB, onChange])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) {
      void handleFileChange(file)
    }
  }, [handleFileChange])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (!isUploading) {
      setIsDragOver(true)
    }
  }, [isUploading])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  const clearImage = useCallback(() => {
    onChange('')
    setError(null)
  }, [onChange])

  return (
    <div className="space-y-2">
      {value ? (
        <div
          className="relative flex w-full max-w-full items-center justify-center overflow-hidden rounded border bg-white p-2"
          style={{ height: square ? previewHeight + 16 : previewHeight * 2 + 16 }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt="Uploaded"
            className="block max-h-full max-w-full object-contain"
            style={square
              ? { width: previewHeight, height: previewHeight }
              : { width: 'auto', height: 'auto' }
            }
            onError={(e) => {
              (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>⚠️</text></svg>'
            }}
          />
          <button
            type="button"
            onClick={clearImage}
            className="absolute right-1 top-1 h-6 w-6 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 z-10 shadow-sm"
            title="移除图片"
          >
            <CloseIcon size={14} />
          </button>
        </div>
      ) : (
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          className="relative"
        >
          <input
            type="file"
            accept={accept}
            onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
            disabled={isUploading}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
            aria-label="上传图片"
          />
          <div
            className={`
              flex flex-col items-center justify-center gap-2
              h-20 px-4 rounded-lg border-2 border-dashed
              ${isUploading
                ? 'bg-gray-50 border-gray-300'
                : isDragOver
                  ? 'bg-blue-50 border-blue-500'
                  : 'bg-slate-50 border-slate-300 hover:bg-slate-100 hover:border-slate-400'}
              transition-colors
            `}
          >
            {isUploading ? (
              <>
                <LoaderIcon size={20} className="text-gray-400" />
                <span className="text-sm text-gray-500">上传中...</span>
              </>
            ) : (
              <>
                <UploadIcon size={20} className="text-slate-400" />
                <span className="text-sm text-slate-500">{placeholder}</span>
                <span className="text-xs text-slate-400">支持 PNG、JPG、SVG，最大 {maxSizeMB}MB</span>
              </>
            )}
          </div>
        </div>
      )}

      {showUrlInput ? (
        <div className="flex min-w-0 gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="或输入图片 URL..."
            className="min-w-0 flex-1 px-3 py-1 text-sm border rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
      ) : null}

      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}
    </div>
  )
}
