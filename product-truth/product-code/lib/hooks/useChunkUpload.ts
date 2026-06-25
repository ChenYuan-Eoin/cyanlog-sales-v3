'use client'

import { useState, useCallback, useRef } from 'react'

export type UploadStatus = 'idle' | 'uploading' | 'paused' | 'completed' | 'error'

export interface ChunkInfo {
  index: number
  start: number
  end: number
  status: 'pending' | 'uploading' | 'completed' | 'error'
  retries: number
}

export interface UploadState {
  status: UploadStatus
  progress: number // 0-100
  chunks: ChunkInfo[]
  uploadedBytes: number
  totalBytes: number
  speed: number // bytes/sec
  error?: string
}

export interface UseChunkUploadOptions {
  chunkSize?: number // default 5MB
  maxRetries?: number // default 3
  concurrency?: number // default 3
  onProgress?: (state: UploadState) => void
  onComplete?: (result: { fileUrl: string; storagePath: string }) => void
  onError?: (error: string) => void
}

const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_MAX_RETRIES = 3
const DEFAULT_CONCURRENCY = 3

function readApiError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const error = (payload as { error?: unknown }).error
    if (typeof error === 'string') {
      return error
    }
    if (error && typeof error === 'object') {
      const message = (error as { message?: unknown }).message
      if (typeof message === 'string') {
        return message
      }
    }
  }

  return fallback
}

export function useChunkUpload(options: UseChunkUploadOptions = {}) {
  const {
    chunkSize = DEFAULT_CHUNK_SIZE,
    maxRetries = DEFAULT_MAX_RETRIES,
    concurrency = DEFAULT_CONCURRENCY,
    onProgress,
    onComplete,
    onError,
  } = options

  const [state, setState] = useState<UploadState>({
    status: 'idle',
    progress: 0,
    chunks: [],
    uploadedBytes: 0,
    totalBytes: 0,
    speed: 0,
  })

  const abortControllerRef = useRef<AbortController | null>(null)
  const startTimeRef = useRef<number>(0)
  const uploadedBytesRef = useRef<number>(0)

  // 初始化分块
  const initChunks = useCallback((fileSize: number): ChunkInfo[] => {
    const chunks: ChunkInfo[] = []
    let start = 0
    let index = 0

    while (start < fileSize) {
      const end = Math.min(start + chunkSize, fileSize)
      chunks.push({
        index,
        start,
        end,
        status: 'pending',
        retries: 0,
      })
      start = end
      index++
    }

    return chunks
  }, [chunkSize])

  // 上传单个分块
  const uploadChunk = useCallback(async (
    chunk: ChunkInfo,
    file: File,
    contractId: string,
    token: string,
    signal: AbortSignal
  ): Promise<void> => {
    const blob = file.slice(chunk.start, chunk.end)
    const formData = new FormData()
    formData.append('chunk', blob)
    formData.append('index', String(chunk.index))
    formData.append('start', String(chunk.start))
    formData.append('end', String(chunk.end))
    formData.append('totalSize', String(file.size))
    formData.append('fileName', file.name)
    formData.append('fileType', file.type)

    const response = await fetch(`/api/contracts/${contractId}/upload-chunk`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
      signal,
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: '上传失败' }))
      throw new Error(readApiError(error, `分块 ${chunk.index} 上传失败`))
    }
  }, [])

  // 开始上传
  const startUpload = useCallback(async (
    file: File,
    contractId: string,
    token: string
  ): Promise<void> => {
    if (!file || !contractId || !token) {
      onError?.('缺少必要参数')
      return
    }

    abortControllerRef.current = new AbortController()
    const signal = abortControllerRef.current.signal
    startTimeRef.current = Date.now()
    uploadedBytesRef.current = 0

    const chunks = initChunks(file.size)

    setState({
      status: 'uploading',
      progress: 0,
      chunks,
      uploadedBytes: 0,
      totalBytes: file.size,
      speed: 0,
    })

    // 并发上传队列
    const queue = [...chunks]
    const activeUploads = new Set<Promise<void>>()
    const completedChunks = new Set<number>()
    const failedChunks = new Set<number>()

    const updateProgress = () => {
      const completedBytes = chunks
        .filter(c => c.status === 'completed')
        .reduce((sum, c) => sum + (c.end - c.start), 0)

      const progress = Math.round((completedBytes / file.size) * 100)
      const elapsed = (Date.now() - startTimeRef.current) / 1000
      const speed = elapsed > 0 ? completedBytes / elapsed : 0

      uploadedBytesRef.current = completedBytes

      setState(prev => ({
        ...prev,
        progress,
        uploadedBytes: completedBytes,
        speed,
        chunks: [...chunks],
      }))

      onProgress?.({
        status: 'uploading',
        progress,
        chunks: [...chunks],
        uploadedBytes: completedBytes,
        totalBytes: file.size,
        speed,
      })
    }

    const processChunk = async (chunk: ChunkInfo): Promise<void> => {
      chunk.status = 'uploading'
      updateProgress()

      try {
        await uploadChunk(chunk, file, contractId, token, signal)
        chunk.status = 'completed'
        completedChunks.add(chunk.index)
        updateProgress()
      } catch (_error) {
        void _error
        chunk.status = 'error'
        chunk.retries++

        if (chunk.retries < maxRetries) {
          // 重试
          chunk.status = 'pending'
          queue.push(chunk)
        } else {
          failedChunks.add(chunk.index)
        }
        updateProgress()
      }
    }

    try {
      while (queue.length > 0 || activeUploads.size > 0) {
        // 填充并发槽
        while (activeUploads.size < concurrency && queue.length > 0) {
          const chunk = queue.shift()!
          const uploadPromise = processChunk(chunk).finally(() => {
            activeUploads.delete(uploadPromise)
          })
          activeUploads.add(uploadPromise)
        }

        if (activeUploads.size > 0) {
          await Promise.race(activeUploads)
        }

        // 检查是否已取消
        if (signal.aborted) {
          throw new Error('上传已取消')
        }
      }

      if (failedChunks.size > 0) {
        throw new Error(`${failedChunks.size} 个分块上传失败`)
      }

      // 合并分块
      const mergeRes = await fetch(`/api/contracts/${contractId}/merge-chunks`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileName: file.name,
          fileType: file.type,
          totalSize: file.size,
          chunkCount: chunks.length,
        }),
        signal,
      })

      if (!mergeRes.ok) {
        const error = await mergeRes.json().catch(() => ({ error: '合并失败' }))
        throw new Error(readApiError(error, '文件合并失败'))
      }

      const result = await mergeRes.json()

      setState(prev => ({
        ...prev,
        status: 'completed',
        progress: 100,
      }))

      onComplete?.({
        fileUrl: result.data.fileUrl,
        storagePath: result.data.storagePath,
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '上传失败'

      setState(prev => ({
        ...prev,
        status: 'error',
        error: errorMessage,
      }))

      onError?.(errorMessage)
    }
  }, [initChunks, uploadChunk, concurrency, maxRetries, onProgress, onComplete, onError])

  // 暂停上传
  const pauseUpload = useCallback(() => {
    abortControllerRef.current?.abort()
    setState(prev => ({
      ...prev,
      status: 'paused',
    }))
  }, [])

  // 取消上传
  const cancelUpload = useCallback(() => {
    abortControllerRef.current?.abort()
    setState({
      status: 'idle',
      progress: 0,
      chunks: [],
      uploadedBytes: 0,
      totalBytes: 0,
      speed: 0,
    })
  }, [])

  return {
    state,
    startUpload,
    pauseUpload,
    cancelUpload,
  }
}
