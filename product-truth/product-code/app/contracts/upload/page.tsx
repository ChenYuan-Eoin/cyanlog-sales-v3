'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ArrowLeftIcon, UploadIcon, FileTextIcon, AlertCircleIcon, PauseIcon, PlayIcon, XIcon } from 'lucide-react'
import { error as toastError, success as toastSuccess } from '@/lib/toast'
import { useChunkUpload } from '@/lib/hooks/useChunkUpload'
import { UploadProgressBar } from '@/components/upload/UploadProgress'
import { cn } from '@/lib/utils'

// 文件类型验证用扩展名而非 MIME 类型，减少浏览器 MIME 差异影响。
const ALLOWED_EXTENSIONS = ['.pdf', '.docx']

// 最大文件大小: 500MB
const MAX_FILE_SIZE = 500 * 1024 * 1024

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

export default function ContractUploadPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isCompareIntent = searchParams.get('intent') === 'compare'
  const [files, setFiles] = useState<File[]>([])
  const [currentFileIndex, setCurrentFileIndex] = useState(0)
  const [contractId, setContractId] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [finalizingReview, setFinalizingReview] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const activeContractIdRef = useRef<string | null>(null)
  const currentFileIndexRef = useRef(currentFileIndex)
  const filesRef = useRef<File[]>(files)

  currentFileIndexRef.current = currentFileIndex
  filesRef.current = files

  const {
    state: uploadState,
    startUpload,
    pauseUpload,
    cancelUpload,
  } = useChunkUpload({
    chunkSize: 5 * 1024 * 1024, // 5MB 分块
    concurrency: 3, // 3个并发
    maxRetries: 3,
    onProgress: () => {
      // 进度状态由 hook 管理，页面只消费状态渲染。
    },
    onComplete: (result) => {
      void handleUploadComplete(result)
    },
    onError: (error) => {
      setErrorMsg(error)
      toastError(error)
    },
  })

  async function submitContractForReview(cid: string, token: string) {
    const submitRes = await fetch(`/api/contracts/${cid}/submit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })

    const submitData = await submitRes.json().catch(() => ({ error: '提交审核失败' }))
    if (!submitRes.ok) {
      throw new Error(readApiError(submitData, '提交审核失败'))
    }

    return submitData
  }

  async function startContractAnalysis(cid: string, token: string) {
    const analyzeRes = await fetch(`/api/contracts/${cid}/analyze`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })

    const analyzeData = await analyzeRes.json().catch(() => ({ error: '启动审核失败' }))
    if (!analyzeRes.ok) {
      throw new Error(readApiError(analyzeData, '启动审核失败'))
    }
    if (analyzeData.status === 'FAILED') {
      throw new Error(analyzeData.processingError || '审核处理失败')
    }

    return analyzeData
  }

  async function handleUploadComplete(result: { contractId: string }) {
    toastSuccess('上传成功')
    const completedContractId = result.contractId || activeContractIdRef.current
    if (!completedContractId) {
      const message = '上传完成但未返回合同ID'
      setErrorMsg(message)
      toastError(message)
      return
    }

    const token = localStorage.getItem('token')
    if (!token) {
      const message = '请先登录'
      setErrorMsg(message)
      toastError(message)
      return
    }

    if (isCompareIntent) {
      router.push(`/contracts/${completedContractId}/compare?from=upload`)
      return
    }

    setFinalizingReview(true)
    try {
      await submitContractForReview(completedContractId, token)
      await startContractAnalysis(completedContractId, token)

      // 所有文件上传完成后跳转
      const completedIndex = currentFileIndexRef.current
      const fileCount = filesRef.current.length
      if (completedIndex >= fileCount - 1) {
        router.push(`/contracts/${completedContractId}`)
      } else {
        // 继续上传下一个文件
        const nextIndex = completedIndex + 1
        setCurrentFileIndex(nextIndex)
        setContractId(null)
        activeContractIdRef.current = null
        setFinalizingReview(false)
        uploadNextFile(nextIndex)
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '审核启动失败'
      setErrorMsg(errorMessage)
      toastError(errorMessage)
      setFinalizingReview(false)
    }
  }

  // 验证文件
  const validateFile = useCallback((file: File): string | null => {
    // 检查文件类型
    const extension = '.' + file.name.split('.').pop()?.toLowerCase()
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
      return `不支持的文件类型: ${extension}，请上传 PDF 或 DOCX 文件`
    }

    // 检查文件大小
    if (file.size > MAX_FILE_SIZE) {
      return `文件大小超过 500MB 限制: ${(file.size / 1024 / 1024).toFixed(2)} MB`
    }

    return null
  }, [])

  // 处理文件选择
  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || [])
    const errors: string[] = []
    const validFiles: File[] = []

    selectedFiles.forEach(file => {
      const error = validateFile(file)
      if (error) {
        errors.push(`${file.name}: ${error}`)
      } else {
        validFiles.push(file)
      }
    })

    if (errors.length > 0) {
      setErrorMsg(errors.join('\n'))
      toastError(errors[0])
    } else {
      setErrorMsg(null)
    }

    if (validFiles.length > 0) {
      setFiles(prev => [...prev, ...validFiles])
    }

    // 清空 input，允许重复选择相同文件
    if (inputRef.current) {
      inputRef.current.value = ''
    }
  }, [validateFile])

  // 拖拽处理
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

    const droppedFiles = Array.from(e.dataTransfer.files)
    const errors: string[] = []
    const validFiles: File[] = []

    droppedFiles.forEach(file => {
      const error = validateFile(file)
      if (error) {
        errors.push(`${file.name}: ${error}`)
      } else {
        validFiles.push(file)
      }
    })

    if (errors.length > 0) {
      setErrorMsg(errors.join('\n'))
      toastError(errors[0])
    } else {
      setErrorMsg(null)
    }

    if (validFiles.length > 0) {
      setFiles(prev => [...prev, ...validFiles])
    }
  }, [validateFile])

  // 删除文件
  const removeFile = useCallback((index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index))
    if (index < currentFileIndex) {
      setCurrentFileIndex(prev => Math.max(0, prev - 1))
    }
  }, [currentFileIndex])

  // 上传单个文件
  const uploadSingleFile = useCallback(async (file: File, cid: string, token: string) => {
    await startUpload(file, cid, token)
  }, [startUpload])

  // 创建合同并上传
  const uploadNextFile = useCallback(async (fileIndex: number) => {
    const token = localStorage.getItem('token')
    if (!token) {
      setErrorMsg('请先登录')
      toastError('请先登录')
      return
    }

    const file = files[fileIndex]
    if (!file) return

    setErrorMsg(null)

    try {
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
        throw new Error(readApiError(err, '创建合同草稿失败'))
      }

      const createData = await createRes.json()
      const cid = createData.data?.contract_id || createData.data?.id

      if (!cid) {
        throw new Error('创建合同草稿失败：未返回合同ID')
      }

      setContractId(cid)
      activeContractIdRef.current = cid

      // 开始分块上传
      await uploadSingleFile(file, cid, token)
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '上传失败'
      setErrorMsg(errorMessage)
      toastError(errorMessage)
    }
  }, [files, uploadSingleFile])

  // 开始上传所有文件
  const handleUpload = useCallback(() => {
    if (files.length === 0 || uploadState.status === 'uploading') return
    setCurrentFileIndex(0)
    setContractId(null)
    activeContractIdRef.current = null
    uploadNextFile(0)
  }, [files, uploadState.status, uploadNextFile])

  // 暂停/继续
  const handlePause = useCallback(() => {
    if (uploadState.status === 'uploading') {
      pauseUpload()
    } else if (uploadState.status === 'paused') {
      // 继续上传
      const token = localStorage.getItem('token')
      if (token && contractId && files[currentFileIndex]) {
        uploadSingleFile(files[currentFileIndex], contractId, token)
      }
    }
  }, [uploadState.status, pauseUpload, files, currentFileIndex, contractId, uploadSingleFile])

  // 取消上传
  const handleCancel = useCallback(() => {
    cancelUpload()
    setFiles([])
    setCurrentFileIndex(0)
    setContractId(null)
    setFinalizingReview(false)
    activeContractIdRef.current = null
  }, [cancelUpload])

  // 格式化文件大小
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
  }

  const isUploading = uploadState.status === 'uploading'
  const isPaused = uploadState.status === 'paused'
  const isBusy = isUploading || finalizingReview

  return (
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/contracts">
            <Button variant="ghost" size="icon" disabled={isBusy}>
              <ArrowLeftIcon className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">
              {isCompareIntent ? '创建文档比对材料' : '批量发起合同审核'}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {isCompareIntent
                ? '上传客户回传版或待比对合同，进入标准合同对照工作台。'
                : '一次上传多个合同源文件；每个文件会创建独立合同与 ReviewRun，并进入审核工作台。'}
            </p>
          </div>
        </div>

        {/* Error Alert */}
        {errorMsg && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-start gap-3">
            <AlertCircleIcon className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-red-700 font-medium">上传失败</p>
              <p className="text-sm text-red-600 whitespace-pre-line">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Upload Area */}
        <div className="bg-white rounded-lg border border-slate-200 p-6">
          {/* Drag & Drop Zone */}
          <div
            className={cn(
              'border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer',
              dragOver && 'border-blue-500 bg-blue-50',
              !dragOver && 'border-slate-300 hover:border-blue-400',
              (isBusy || files.length > 0) && 'pointer-events-none opacity-50'
            )}
            onClick={() => inputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              ref={inputRef}
              id="file-input"
              type="file"
              accept=".pdf,.docx"
              multiple
              className="hidden"
              onChange={handleFileChange}
              disabled={isBusy}
            />
            <UploadIcon className="h-10 w-10 text-slate-400 mx-auto mb-3" />
            <p className="text-sm text-slate-600 mb-1">
              {isCompareIntent ? '点击选择待比对合同或拖拽到此处' : '点击选择待审核源文件或拖拽到此处'}
            </p>
            <p className="text-xs text-slate-400">
              支持 PDF、DOCX 格式，单个文件最大 500MB
            </p>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="mt-6 space-y-3">
              <h3 className="text-sm font-medium text-slate-700">
                待上传文件 ({files.length}个)
              </h3>

              {files.map((file, index) => (
                <div
                  key={`${file.name}-${index}`}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-lg border',
                    index === currentFileIndex && isUploading
                      ? 'bg-blue-50 border-blue-200'
                      : index < currentFileIndex
                      ? 'bg-green-50 border-green-200'
                      : 'bg-slate-50 border-slate-200'
                  )}
                >
                  <FileTextIcon className={cn(
                    'h-5 w-5 shrink-0',
                    index === currentFileIndex && isUploading && 'text-blue-500',
                    index < currentFileIndex && 'text-green-500',
                    index > currentFileIndex && 'text-slate-400'
                  )} />

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{file.name}</p>
                    <p className="text-xs text-slate-500">{formatFileSize(file.size)}</p>
                  </div>

                  {/* 当前上传文件的进度 */}
                  {index === currentFileIndex && (isBusy || isPaused || uploadState.status === 'error') && (
                    <div className="w-32 shrink-0">
                      <UploadProgressBar
                        progress={uploadState.progress}
                        uploadedBytes={uploadState.uploadedBytes}
                        totalBytes={uploadState.totalBytes}
                        speed={uploadState.speed}
                        status={uploadState.status}
                        chunks={uploadState.chunks}
                      />
                    </div>
                  )}

                  {/* 状态图标 */}
                  {index < currentFileIndex && (
                    <span className="text-xs text-green-600 font-medium">已完成</span>
                  )}

                  {/* 删除按钮 */}
                  {!isBusy && index >= currentFileIndex && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => removeFile(index)}
                    >
                      <XIcon className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Action Buttons */}
          {files.length > 0 && (
            <div className="mt-6 flex items-center justify-end gap-2">
              {(isBusy || isPaused) && (
                <>
                  {finalizingReview ? (
                    <Button variant="outline" disabled>
                      <FileTextIcon className="h-4 w-4 mr-1" />
                      {isCompareIntent ? '准备比对中...' : '生成审核中...'}
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        onClick={handlePause}
                      >
                        {isPaused ? (
                          <>
                            <PlayIcon className="h-4 w-4 mr-1" />
                            继续
                          </>
                        ) : (
                          <>
                            <PauseIcon className="h-4 w-4 mr-1" />
                            暂停
                          </>
                        )}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={handleCancel}
                      >
                        取消
                      </Button>
                    </>
                  )}
                </>
              )}

              {!isBusy && !isPaused && (
                <Button
                  onClick={handleUpload}
                  disabled={currentFileIndex >= files.length}
                >
                  {currentFileIndex >= files.length
                    ? '全部完成'
                    : isCompareIntent
                      ? `上传并进入比对 (${files.length - currentFileIndex}个)`
                      : `批量上传并发起审核 (${files.length - currentFileIndex}个)`}
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Upload Tips */}
        <div className="mt-6 text-xs text-slate-500 space-y-1">
          <p>• 支持大文件分块上传，单个文件最大 500MB</p>
          <p>• 支持断点续传，上传中断后可继续</p>
          <p>• 3个分块并发上传，提高传输速度</p>
          <p>
            {isCompareIntent
              ? '• 比对材料会复用合同版本资产，上传后进入标准模板对照，不自动启动风险审核。'
              : '• 这是批量审核入口，不用于导入客户回传件；客户回传件请在单个合同工作台的“版本与产物”中补充。'}
          </p>
        </div>
      </div>
    </div>
  )
}
