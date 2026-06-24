'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'

interface ChunkProgressProps {
  chunks: Array<{
    index: number
    status: 'pending' | 'uploading' | 'completed' | 'error'
  }>
  className?: string
}

export function ChunkProgress({ chunks, className }: ChunkProgressProps) {
  const stats = useMemo(() => {
    const total = chunks.length
    const completed = chunks.filter(c => c.status === 'completed').length
    const uploading = chunks.filter(c => c.status === 'uploading').length
    const error = chunks.filter(c => c.status === 'error').length
    return { total, completed, uploading, error }
  }, [chunks])

  if (chunks.length === 0) return null

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>分块进度</span>
        <span>
          {stats.completed}/{stats.total} 完成
          {stats.uploading > 0 && ` · ${stats.uploading} 上传中`}
          {stats.error > 0 && ` · ${stats.error} 失败`}
        </span>
      </div>

      <div className="flex flex-wrap gap-0.5">
        {chunks.map((chunk) => (
          <div
            key={chunk.index}
            className={cn(
              'h-1.5 w-1.5 rounded-full transition-colors',
              chunk.status === 'completed' && 'bg-green-500',
              chunk.status === 'uploading' && 'bg-blue-500 animate-pulse',
              chunk.status === 'error' && 'bg-red-500',
              chunk.status === 'pending' && 'bg-slate-200'
            )}
            title={`分块 ${chunk.index + 1}: ${chunk.status}`}
          />
        ))}
      </div>
    </div>
  )
}

interface UploadProgressBarProps {
  progress: number
  uploadedBytes: number
  totalBytes: number
  speed: number
  status: 'idle' | 'uploading' | 'paused' | 'completed' | 'error'
  chunks?: Array<{
    index: number
    status: 'pending' | 'uploading' | 'completed' | 'error'
  }>
  className?: string
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`
}

export function UploadProgressBar({
  progress,
  uploadedBytes,
  totalBytes,
  speed,
  status,
  chunks,
  className,
}: UploadProgressBarProps) {
  const statusText = useMemo(() => {
    switch (status) {
      case 'uploading':
        return '上传中...'
      case 'paused':
        return '已暂停'
      case 'completed':
        return '上传完成'
      case 'error':
        return '上传失败'
      default:
        return '等待上传'
    }
  }, [status])

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between text-sm">
        <span className={cn(
          'font-medium',
          status === 'error' && 'text-red-600',
          status === 'completed' && 'text-green-600'
        )}>
          {statusText}
        </span>
        <span className="text-slate-500">
          {formatBytes(uploadedBytes)} / {formatBytes(totalBytes)}
          {speed > 0 && status === 'uploading' && ` · ${formatSpeed(speed)}`}
        </span>
      </div>

      <div className="relative h-2 overflow-hidden rounded-full bg-slate-100">
        <div
          className={cn(
            'h-full transition-all duration-300 ease-out',
            status === 'error' && 'bg-red-500',
            status === 'completed' && 'bg-green-500',
            status === 'uploading' && 'bg-blue-500',
            status === 'paused' && 'bg-amber-500'
          )}
          style={{ width: `${progress}%` }}
        />
      </div>

      {chunks && chunks.length > 0 && (
        <ChunkProgress chunks={chunks} className="pt-2" />
      )}
    </div>
  )
}
