'use client'

import { useState, useCallback, useRef } from 'react'
import { readUploadErrorMessage } from '@/lib/documents/upload-error'
import {
  CONTRACT_UPLOAD_CHUNK_BYTES,
  stableSourceUploadId,
  validateUploadSize,
} from '@/lib/documents/chunk-upload-protocol'

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
  /** @deprecated 分块大小由服务端协议固定为 4MiB。 */
  chunkSize?: number
  maxRetries?: number // default 3
  concurrency?: number // default 3
  onProgress?: (state: UploadState) => void
  onComplete?: (result: {
    fileUrl: string
    storagePath: string
    contractId: string
    fileName: string
    uploadId: string
    sha256: string
    sourceTextHash: string | null
    preparationStatus: 'READY' | 'AWAITING_OCR' | 'AWAITING_CONVERSION'
    preparationReason: 'PDF_TEXT_UNAVAILABLE' | 'LEGACY_DOC_REQUIRES_CONVERSION' | null
    reviewReady: boolean
    renderMode: 'native-pdf' | 'browser-ooxml' | 'identity-only'
    pageMapLocator: 'provisional' | null
    contractStatus: 'PENDING' | 'DRAFT'
  }) => void
  onError?: (error: string) => void
}

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_CONCURRENCY = 3

class UploadHttpError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = 'UploadHttpError'
  }
}

async function fileSha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function useChunkUpload(options: UseChunkUploadOptions = {}) {
  const {
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
  const activeRunRef = useRef<{ runId: number; controller: AbortController } | null>(null)
  const nextRunIdRef = useRef(0)
  const resumableSessionRef = useRef<{
    fileKey: string
    uploadId: string
    contractId: string
    token: string
    chunkCount: number
    expectedSha256: string
  } | null>(null)
  const startTimeRef = useRef<number>(0)
  const uploadedBytesRef = useRef<number>(0)

  // 初始化分块
  const initChunks = useCallback((fileSize: number): ChunkInfo[] => {
    const chunks: ChunkInfo[] = []
    let start = 0
    let index = 0

    while (start < fileSize) {
      const end = Math.min(start + CONTRACT_UPLOAD_CHUNK_BYTES, fileSize)
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
  }, [])

  // 上传单个分块
  const uploadChunk = useCallback(async (
    chunk: ChunkInfo,
    file: File,
    contractId: string,
    token: string,
    signal: AbortSignal,
    uploadId: string,
    expectedSha256: string,
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
    formData.append('uploadId', uploadId)
    formData.append('expectedSha256', expectedSha256)

    const response = await fetch(`/api/contracts/${contractId}/upload-chunk`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      body: formData,
      signal,
    })

    if (!response.ok) {
      const message = await readUploadErrorMessage(response, `分块 ${chunk.index} 上传失败`)
      const retryable = response.status === 408
        || response.status === 425
        || response.status === 429
        || response.status >= 500
      throw new UploadHttpError(message, retryable)
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
    // React state 在下一次 render 前仍可能是 idle；同步 run gate 才能阻止双击并发。
    if (activeRunRef.current && !activeRunRef.current.controller.signal.aborted) {
      return
    }
    const sizeValidation = validateUploadSize(file.size)
    if (!sizeValidation.ok) {
      onError?.(sizeValidation.error)
      return
    }

    const controller = new AbortController()
    const runId = ++nextRunIdRef.current
    activeRunRef.current = { runId, controller }
    abortControllerRef.current = controller
    const signal = controller.signal
    startTimeRef.current = Date.now()
    uploadedBytesRef.current = 0

    const chunks = initChunks(file.size)
    const fileKey = `${contractId}:${file.name}:${file.size}:${file.lastModified}`
    const previousSession = resumableSessionRef.current?.fileKey === fileKey
      ? resumableSessionRef.current
      : null

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
    const failedChunks = new Set<number>()
    let terminalError: Error | null = null
    let expectedSha256: string
    let uploadId: string

    try {
      expectedSha256 = previousSession?.expectedSha256 ?? await fileSha256(file)
      uploadId = await stableSourceUploadId(contractId, expectedSha256)
      if (signal.aborted || activeRunRef.current?.runId !== runId) {
        if (activeRunRef.current?.runId === runId) activeRunRef.current = null
        if (abortControllerRef.current === controller) abortControllerRef.current = null
        return
      }
      resumableSessionRef.current = {
        fileKey,
        uploadId,
        contractId,
        token,
        chunkCount: chunks.length,
        expectedSha256,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '无法计算文件摘要'
      setState(prev => ({ ...prev, status: 'error', error: message }))
      onError?.(message)
      if (activeRunRef.current?.runId === runId) activeRunRef.current = null
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      return
    }

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
        await uploadChunk(
          chunk,
          file,
          contractId,
          token,
          signal,
          uploadId,
          expectedSha256
        )
        chunk.status = 'completed'
        updateProgress()
      } catch (error) {
        if (signal.aborted) {
          chunk.status = 'pending'
          return
        }

        chunk.status = 'error'
        chunk.retries++
        const retryable = error instanceof UploadHttpError ? error.retryable : true

        if (retryable && chunk.retries < maxRetries) {
          // 重试
          chunk.status = 'pending'
          queue.push(chunk)
        } else {
          failedChunks.add(chunk.index)
          terminalError = error instanceof Error ? error : new Error('分块上传失败')
          queue.length = 0
          controller.abort()
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
          if (terminalError) throw terminalError
          throw new Error('上传已取消')
        }
      }

      if (failedChunks.size > 0) {
        throw terminalError ?? new Error(`${failedChunks.size} 个分块上传失败`)
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
          uploadId,
          expectedSha256,
        }),
        signal,
      })

      if (!mergeRes.ok) {
        throw new Error(await readUploadErrorMessage(mergeRes, '文件合并失败'))
      }

      const result = await mergeRes.json()
      const resultData = result?.data
      const preparationStatus = resultData?.preparationStatus
      const reviewReady = resultData?.reviewReady
      const sourceTextHash = resultData?.sourceTextHash
      const preparationReason = resultData?.preparationReason
      const renderMode = resultData?.renderMode
      const pageMapLocator = resultData?.pageMapLocator
      const contractStatus = resultData?.contractStatus
      const sourceStateIsConsistent = preparationStatus === 'READY'
        ? reviewReady === true
          && typeof sourceTextHash === 'string'
          && /^[0-9a-f]{64}$/i.test(sourceTextHash)
          && preparationReason === null
          && (renderMode === 'native-pdf' || renderMode === 'browser-ooxml')
          && pageMapLocator === 'provisional'
          && contractStatus === 'PENDING'
        : preparationStatus === 'AWAITING_OCR'
          ? reviewReady === false
            && sourceTextHash === null
            && preparationReason === 'PDF_TEXT_UNAVAILABLE'
            && renderMode === 'native-pdf'
            && pageMapLocator === null
            && contractStatus === 'DRAFT'
          : preparationStatus === 'AWAITING_CONVERSION'
            && reviewReady === false
            && sourceTextHash === null
            && preparationReason === 'LEGACY_DOC_REQUIRES_CONVERSION'
            && renderMode === 'identity-only'
            && pageMapLocator === null
            && contractStatus === 'DRAFT'
      if (
        !resultData
        || typeof resultData.fileUrl !== 'string'
        || typeof resultData.storagePath !== 'string'
        || typeof resultData.sourceHash !== 'string'
        || resultData.sourceHash !== expectedSha256
        || !sourceStateIsConsistent
      ) {
        throw new Error('文件已合并，但返回的源文件身份不完整或不一致')
      }

      if (signal.aborted || activeRunRef.current?.runId !== runId) return

      setState(prev => ({
        ...prev,
        status: 'completed',
        progress: 100,
      }))

      // 当前 run 已完成；在回调启动队列下一文件前释放同步 gate。
      if (activeRunRef.current?.runId === runId) activeRunRef.current = null
      if (abortControllerRef.current === controller) abortControllerRef.current = null
      if (resumableSessionRef.current?.uploadId === uploadId) {
        resumableSessionRef.current = null
      }

      onComplete?.({
        fileUrl: resultData.fileUrl,
        storagePath: resultData.storagePath,
        contractId,
        fileName: file.name,
        uploadId,
        sha256: expectedSha256,
        sourceTextHash,
        preparationStatus,
        preparationReason,
        reviewReady,
        renderMode,
        pageMapLocator,
        contractStatus,
      })
    } catch (error) {
      // 用户暂停/取消由对应动作维护状态；异步 fetch 的 AbortError 不得把它覆盖成 error。
      if (signal.aborted && !terminalError) return

      const errorMessage = error instanceof Error ? error.message : '上传失败'

      setState(prev => ({
        ...prev,
        status: 'error',
        error: errorMessage,
      }))

      onError?.(errorMessage)
    } finally {
      if (activeRunRef.current?.runId === runId) activeRunRef.current = null
      if (abortControllerRef.current === controller) abortControllerRef.current = null
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
  const cancelUpload = useCallback(async (): Promise<boolean> => {
    const session = resumableSessionRef.current
    abortControllerRef.current?.abort()
    resumableSessionRef.current = null
    setState({
      status: 'idle',
      progress: 0,
      chunks: [],
      uploadedBytes: 0,
      totalBytes: 0,
      speed: 0,
    })

    if (!session) return true

    try {
      const response = await fetch(`/api/contracts/${session.contractId}/upload-chunk`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          uploadId: session.uploadId,
          expectedSha256: session.expectedSha256,
          chunkCount: session.chunkCount,
        }),
      })
      // 409 表示 merge 已提交或合同状态已经变化；调用方不得继续删除合同草稿。
      return response.ok
    } catch {
      // UI 立即退出，但上层只有在服务端确认取消后才会删除草稿合同。
      return false
    }
  }, [])

  return {
    state,
    startUpload,
    pauseUpload,
    cancelUpload,
  }
}
