'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useChunkUpload } from '@/lib/hooks/useChunkUpload'
import { CONTRACT_SOURCE_FORMAT_LABEL } from '@/lib/contracts/contract-source-readiness'

// 发起合同审核：上传源文件是唯一前置条件；业务上下文由 CRM、文件解析或人工补录提供。

interface ContractForm {
  contract_no: string
  party_a_name: string
  party_b_name: string
  party_b_contact: string
  contract_date: string
  effective_date: string
  expiry_date: string
  contract_amount: string
  tax_amount: string
  payment_terms: string
  delivery_terms: string
  notes: string
}

type UploadStage =
  | 'idle'
  | 'creating'
  | 'uploading'
  | 'preparing'
  | 'starting_review'
  | 'awaiting_ocr'
  | 'awaiting_conversion'
  | 'done'

interface FinalizedSourceUpload {
  fileUrl: string
  storagePath: string
  contractId: string
  fileName: string
  uploadId: string
  sha256: string
  sourceTextHash: string | null
  preparationStatus: 'READY' | 'AWAITING_OCR' | 'AWAITING_CONVERSION'
  reviewReady: boolean
}

interface RecoverableReviewSession {
  contractId: string | null
  clientRequestId: string
  fileName: string
  fileSize: number
  fileLastModified: number
  fileSha256: string
  authScopeHash: string
  uploadId: string | null
  sourceStatus: 'CREATING' | 'UPLOADING' | 'READY' | 'AWAITING_OCR' | 'AWAITING_CONVERSION'
}

const initialForm: ContractForm = {
  contract_no: '',
  party_a_name: '',
  party_b_name: '',
  party_b_contact: '',
  contract_date: '',
  effective_date: '',
  expiry_date: '',
  contract_amount: '',
  tax_amount: '',
  payment_terms: '',
  delivery_terms: '',
  notes: '',
}

const RECOVERY_STORAGE_KEY = 'price-v3:recoverable-contract-review'
const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.docm']

const uploadStages: Array<{ value: UploadStage; label: string; description: string }> = [
  { value: 'creating', label: '准备合同记录', description: '为这份源文件建立唯一合同任务' },
  { value: 'uploading', label: '保存源文件', description: '完整保留原始 Word/PDF，不重排原文' },
  { value: 'preparing', label: '读取原文并建立定位', description: '确认正文和风险批注可以回到原文位置' },
  { value: 'starting_review', label: '发起风险审核', description: '按已发布规则集和管理员配置的模型执行' },
  { value: 'done', label: '进入工作台', description: '跳转到风险定位与批注工作台' },
]

function validateReviewFile(file: File): string | null {
  const extension = `.${file.name.split('.').pop()?.toLowerCase() || ''}`
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return `不支持的文件类型: ${extension}，请上传 ${CONTRACT_SOURCE_FORMAT_LABEL}`
  }
  if (file.size < 1) return '文件内容为空，请重新选择'
  if (file.size > 50 * 1024 * 1024) {
    return `文件大小超过 50MB 限制: ${(file.size / 1024 / 1024).toFixed(2)} MB`
  }
  return null
}

function readApiError(payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const data = payload as { error?: unknown }
    if (typeof data.error === 'string') {
      return data.error
    }
    if (data.error && typeof data.error === 'object') {
      const message = (data.error as { message?: unknown }).message
      if (typeof message === 'string') {
        return message
      }
    }
  }
  return fallback
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed || undefined
}

function optionalAmount(value: string): number | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : undefined
}

function buildContractPayload(form: ContractForm, file: File) {
  const notes = [
    optionalText(form.notes),
    `审核源文件: ${file.name}`,
  ].filter(Boolean).join('\n')

  return {
    contract_no: optionalText(form.contract_no),
    party_a_name: optionalText(form.party_a_name),
    party_b_name: optionalText(form.party_b_name) ?? '待识别客户',
    party_b_contact: optionalText(form.party_b_contact),
    contract_date: optionalText(form.contract_date),
    effective_date: optionalText(form.effective_date),
    expiry_date: optionalText(form.expiry_date),
    contract_amount: optionalAmount(form.contract_amount),
    tax_amount: optionalAmount(form.tax_amount),
    payment_terms: optionalText(form.payment_terms),
    delivery_terms: optionalText(form.delivery_terms),
    notes: notes || undefined,
  }
}

async function sha256Hex(value: Blob | string): Promise<string> {
  const bytes = typeof value === 'string'
    ? new TextEncoder().encode(value)
    : await value.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

function readRecoverableSession(): RecoverableReviewSession | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(RECOVERY_STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<RecoverableReviewSession>
    if (
      !(value.contractId === null || typeof value.contractId === 'string')
      || typeof value.clientRequestId !== 'string'
      || typeof value.fileName !== 'string'
      || typeof value.fileSize !== 'number'
      || typeof value.fileLastModified !== 'number'
      || typeof value.fileSha256 !== 'string'
      || !/^[0-9a-f]{64}$/i.test(value.fileSha256)
      || typeof value.authScopeHash !== 'string'
      || !/^[0-9a-f]{64}$/i.test(value.authScopeHash)
      || !(value.uploadId === null || typeof value.uploadId === 'string')
      || !['CREATING', 'UPLOADING', 'READY', 'AWAITING_OCR', 'AWAITING_CONVERSION'].includes(String(value.sourceStatus))
    ) return null
    return value as RecoverableReviewSession
  } catch {
    return null
  }
}

function sameRecoveryFile(
  session: RecoverableReviewSession | null,
  file: File,
  fileSha256: string,
  authScopeHash: string,
) {
  return Boolean(
    session
    && session.authScopeHash === authScopeHash
    && session.fileSha256 === fileSha256
    && session.fileName === file.name
    && session.fileSize === file.size
    && session.fileLastModified === file.lastModified,
  )
}

export default function NewContractPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<ContractForm>(initialForm)
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState<UploadStage>('idle')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [recoverySession, setRecoverySession] = useState<RecoverableReviewSession | null>(null)
  const pendingUploadRef = useRef<{
    resolve: (result: FinalizedSourceUpload) => void
    reject: (error: Error) => void
  } | null>(null)

  const persistRecoverySession = useCallback((session: RecoverableReviewSession | null) => {
    setRecoverySession(session)
    if (session) {
      window.localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(session))
    } else {
      window.localStorage.removeItem(RECOVERY_STORAGE_KEY)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const recovered = readRecoverableSession()
      const token = window.localStorage.getItem('token')
      if (!recovered || !token) return
      const authScopeHash = await sha256Hex(token)
      if (cancelled) return
      if (recovered.authScopeHash !== authScopeHash) {
        window.localStorage.removeItem(RECOVERY_STORAGE_KEY)
        return
      }
      setRecoverySession(recovered)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const {
    state: uploadState,
    startUpload,
  } = useChunkUpload({
    concurrency: 3,
    maxRetries: 3,
    onProgress: (nextState) => {
      if (nextState.progress >= 100) setStage('preparing')
    },
    onComplete: (result) => {
      pendingUploadRef.current?.resolve(result)
      pendingUploadRef.current = null
    },
    onError: (message) => {
      pendingUploadRef.current?.reject(new Error(message))
      pendingUploadRef.current = null
    },
  })

  const handleInputChange = useCallback((field: keyof ContractForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setError('')
    setNotice('')
  }, [])

  const selectFile = useCallback((selectedFile: File) => {
    const validationError = validateReviewFile(selectedFile)
    if (validationError) {
      setError(validationError)
      setFile(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setFile(selectedFile)
    setError('')
    setNotice('')
  }, [])

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    if (e.dataTransfer.files?.[0]) {
      selectFile(e.dataTransfer.files[0])
    }
  }, [selectFile])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      selectFile(e.target.files[0])
    }
  }

  async function startContractAnalysis(
    cid: string,
    token: string,
    source: { uploadId: string; fileSha256: string },
  ) {
    const res = await fetch(`/api/contracts/${cid}/analyze`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expected_upload_id: source.uploadId,
        expected_file_sha256: source.fileSha256,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(readApiError(data, '启动审核失败'))
    }
    if (data?.status === 'FAILED') {
      throw new Error(data.processingError || '审核处理失败，请重试')
    }
    return data
  }

  function uploadSourceFile(selectedFile: File, contractId: string, token: string) {
    return new Promise<FinalizedSourceUpload>((resolve, reject) => {
      if (pendingUploadRef.current) {
        reject(new Error('当前文件仍在处理中，请勿重复提交'))
        return
      }
      pendingUploadRef.current = { resolve, reject }
      void startUpload(selectedFile, contractId, token).catch((uploadError) => {
        if (!pendingUploadRef.current) return
        pendingUploadRef.current = null
        reject(uploadError instanceof Error ? uploadError : new Error('文件上传失败'))
      })
    })
  }

  async function createContract(
    fileToUpload: File,
    token: string,
    intent: RecoverableReviewSession,
  ) {
    const createRes = await fetch('/api/contracts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        ...buildContractPayload(form, fileToUpload),
        client_request_id: intent.clientRequestId,
      }),
    })
    const createData = await createRes.json().catch(() => ({}))
    if (!createRes.ok) {
      throw new Error(readApiError(createData, '创建审核任务失败'))
    }

    const contractId =
      createData?.data?.contract_id
      || createData?.contract_id
      || createData?.data?.id
      || createData?.id
    if (typeof contractId !== 'string' || !contractId) {
      throw new Error('创建成功但未返回合同ID')
    }

    const session: RecoverableReviewSession = {
      ...intent,
      contractId,
      sourceStatus: 'UPLOADING',
    }
    persistRecoverySession(session)
    return session
  }

  async function continueRecoveredReview() {
    if (!recoverySession?.contractId || recoverySession.sourceStatus !== 'READY') return
    if (!recoverySession.uploadId) {
      setError('源文件已保存，但缺少可核验的上传身份；请重新选择同一文件恢复。')
      return
    }
    const token = window.localStorage.getItem('token')
    if (!token) {
      setError('请先登录')
      return
    }
    setLoading(true)
    setError('')
    setNotice('')
    setStage('starting_review')
    try {
      await startContractAnalysis(
        recoverySession.contractId,
        token,
        {
          uploadId: recoverySession.uploadId,
          fileSha256: recoverySession.fileSha256,
        },
      )
      const completedContractId = recoverySession.contractId
      persistRecoverySession(null)
      setStage('done')
      router.push(`/contracts/${completedContractId}`)
    } catch (recoveryError) {
      setError(`源文件已保存，审核尚未启动：${recoveryError instanceof Error ? recoveryError.message : '请重试'}`)
      setLoading(false)
    }
  }

  async function handleUploadAndStart(e?: React.FormEvent) {
    e?.preventDefault()
    if (!file) {
      setError('请先选择合同源文件')
      return
    }

    setLoading(true)
    setError('')
    setNotice('')

    try {
      const token = window.localStorage.getItem('token')
      if (!token) {
        throw new Error('请先登录')
      }

      const authScopeHash = await sha256Hex(token)
      const fileSha256 = await sha256Hex(file)
      const storedSession = readRecoverableSession()
      let session = sameRecoveryFile(storedSession, file, fileSha256, authScopeHash)
        ? storedSession
        : null
      if (!session) {
        session = {
          contractId: null,
          clientRequestId: crypto.randomUUID(),
          fileName: file.name,
          fileSize: file.size,
          fileLastModified: file.lastModified,
          fileSha256,
          authScopeHash,
          uploadId: null,
          sourceStatus: 'CREATING',
        }
        persistRecoverySession(session)
      }
      if (!session.contractId) {
        setStage('creating')
        session = await createContract(file, token, session)
      }
      const contractId = session.contractId
      if (!contractId) throw new Error('合同创建尚未返回身份，请重试恢复同一创建请求')

      if (session.sourceStatus === 'AWAITING_OCR') {
        setStage('awaiting_ocr')
        setNotice('原始 PDF 已完整保存，但目前无法可靠读取正文。完成 OCR 或改传可检索 PDF 后才能发起审核。')
        setLoading(false)
        return
      }
      if (session.sourceStatus === 'AWAITING_CONVERSION') {
        setStage('awaiting_conversion')
        setNotice('旧版 DOC 原件已完整保存。请用 Word 或 LibreOffice 转为 DOCX 后，在这份合同中补传可审核版本；系统不会伪造原文定位或启动审核。')
        setLoading(false)
        return
      }

      if (session.sourceStatus !== 'READY') {
        setStage('uploading')
        const finalized = await uploadSourceFile(file, contractId, token)
        if (finalized.sha256 !== session.fileSha256) {
          throw new Error('已保存文件与当前选择文件不一致，审核已停止')
        }
        session = {
          ...session,
          uploadId: finalized.uploadId,
          sourceStatus: finalized.reviewReady && finalized.preparationStatus === 'READY'
            ? 'READY'
            : finalized.preparationStatus,
        }
        persistRecoverySession(session)
        if (session.sourceStatus === 'AWAITING_OCR') {
          setStage('awaiting_ocr')
          setNotice('原始 PDF 已完整保存，但目前无法可靠读取正文。完成 OCR 或改传可检索 PDF 后才能发起审核。')
          setLoading(false)
          return
        }
        if (session.sourceStatus === 'AWAITING_CONVERSION') {
          setStage('awaiting_conversion')
          setNotice('旧版 DOC 原件已完整保存。请用 Word 或 LibreOffice 转为 DOCX 后，在这份合同中补传可审核版本；系统不会伪造原文定位或启动审核。')
          setLoading(false)
          return
        }
      }

      if (!session.uploadId) {
        throw new Error('当前源文件缺少可核验的上传身份，审核已停止')
      }
      setStage('starting_review')
      await startContractAnalysis(contractId, token, {
        uploadId: session.uploadId,
        fileSha256: session.fileSha256,
      })

      setStage('done')
      persistRecoverySession(null)
      router.push(`/contracts/${contractId}`)
    } catch (err) {
      const savedSession = readRecoverableSession()
      const prefix = savedSession?.sourceStatus === 'READY'
        ? '源文件已保存，本次不会重复创建版本。'
        : savedSession?.sourceStatus === 'UPLOADING'
          ? '合同任务已保留，可重新提交同一文件继续上传。'
          : savedSession?.sourceStatus === 'CREATING'
            ? '创建请求已保留，重试会恢复同一份合同。'
          : ''
      setError(`${prefix}${err instanceof Error ? err.message : '网络错误，请稍后重试'}`)
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="w-fit">单合同审核</Badge>
            <div>
              <h1 className="text-2xl font-bold text-slate-950">发起合同审核</h1>
              <p className="mt-1 text-sm text-slate-500">
                上传一份 {CONTRACT_SOURCE_FORMAT_LABEL} 原文件。系统先保留原件、确认正文与风险定位，再创建一次审核任务。
              </p>
            </div>
          </div>
          <Link href="/contracts" className="shrink-0">
            <Button variant="outline" size="sm">返回合同中心</Button>
          </Link>
        </header>

        {error && (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="py-3">
              <p className="text-sm font-medium text-red-700" aria-live="polite">{error}</p>
            </CardContent>
          </Card>
        )}

        {notice && (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="space-y-2 py-4">
              <p className="text-sm font-semibold text-amber-900">文件已经安全保存，审核尚未开始</p>
              <p className="text-sm leading-6 text-amber-800" aria-live="polite">{notice}</p>
              {recoverySession?.contractId && (
                <div className="flex flex-wrap gap-4">
                  <Link
                    href={`/contracts/${recoverySession.contractId}/edit?intent=source-replacement`}
                    className="inline-flex text-sm font-medium text-amber-900 underline"
                  >
                    {recoverySession.sourceStatus === 'AWAITING_OCR' ? '补传可检索 PDF' : '补传 DOCX'}
                  </Link>
                  <Link href={`/contracts/${recoverySession.contractId}`} className="inline-flex text-sm text-amber-900 underline">
                    查看这份合同
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {recoverySession && !loading && !notice && (
          <Card className="border-blue-200 bg-blue-50">
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-blue-950">
                  {recoverySession.sourceStatus === 'READY'
                    ? '发现一份已保存、尚未进入工作台的合同'
                    : recoverySession.sourceStatus === 'AWAITING_OCR'
                      ? '发现一份等待正文识别的扫描 PDF'
                      : recoverySession.sourceStatus === 'AWAITING_CONVERSION'
                        ? '发现一份已保留、需要转换后审核的旧版 Word 文件'
                      : recoverySession.sourceStatus === 'CREATING'
                        ? '发现一项可恢复的合同创建请求'
                        : '发现一项未完成的文件上传'}
                </p>
                <p className="mt-1 text-sm text-blue-800">{recoverySession.fileName}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {recoverySession.contractId && recoverySession.sourceStatus === 'READY' && (
                  <Button type="button" size="sm" onClick={() => void continueRecoveredReview()}>
                    继续启动审核
                  </Button>
                )}
                {recoverySession.contractId && (
                  <Link
                    href={`/contracts/${recoverySession.contractId}`}
                    className={buttonVariants({ size: 'sm', variant: 'outline' })}
                  >
                    查看合同
                  </Link>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    persistRecoverySession(null)
                    setStage('idle')
                    setError('')
                    setNotice('')
                  }}
                >
                  发起另一份审核
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <form onSubmit={handleUploadAndStart} className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>合同源文件</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.doc,.docx,.docm"
                  onChange={handleFileChange}
                  className="hidden"
                  id="contract-file"
                />
	                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      fileInputRef.current?.click()
                    }
                  }}
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  className={`rounded-lg border-2 border-dashed p-8 text-center transition-colors sm:p-12 ${
                    dragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-300 bg-white'
	                  } ${file ? 'border-green-500 bg-green-50' : ''}`}
	                  aria-label="选择或拖拽合同源文件"
	                >
                  {file ? (
                    <div className="space-y-3">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-white text-sm font-semibold text-green-700 shadow-sm">
                        {file.name.split('.').pop()?.toUpperCase() || 'FILE'}
                      </div>
                      <div>
                        <p className="break-all text-base font-semibold text-green-800">{file.name}</p>
                        <p className="mt-1 text-sm text-slate-500">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                          {file.type ? ` · ${file.type}` : ''}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={(event) => {
                          event.stopPropagation()
                          setFile(null)
                          if (fileInputRef.current) fileInputRef.current.value = ''
                        }}
                      >
                        重新选择
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-lg bg-slate-100 text-sm font-semibold text-slate-600">
                        PDF
                      </div>
                      <div>
                        <p className="text-base font-semibold text-slate-900">拖拽或选择合同文件</p>
                        <p className="mt-1 text-sm text-slate-500">支持 {CONTRACT_SOURCE_FORMAT_LABEL}，最大 50MB</p>
                        <p className="mt-1 text-xs text-slate-400">扫描 PDF 会先保留原件；没有可靠正文时不会误启动审核</p>
                      </div>
                      <Button type="button" variant="outline" size="sm">
                        选择文件
                      </Button>
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
	                  <Button type="submit" disabled={!file || loading || Boolean(notice)} className="sm:min-w-48">
	                    {loading
	                      ? `${currentUploadStageLabel(stage)}…`
	                      : stage === 'awaiting_ocr'
	                        ? '原件已保存，待正文识别'
	                        : stage === 'awaiting_conversion'
	                          ? '原件已保存，待转换'
	                          : '保存原文件并发起审核'}
	                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setFile(null)
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    }}
                    disabled={!file || loading}
                  >
                    清除文件
                  </Button>
                </div>
              </CardContent>
            </Card>

	            <Card>
	              <CardHeader>
	                <CardTitle>审核上下文与进度</CardTitle>
	              </CardHeader>
	              <CardContent className="space-y-4 text-sm text-slate-600">
	                <UploadStageList stage={stage} active={loading} progress={uploadState.progress} />
	                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
	                  <p className="font-medium text-slate-900">当前阶段</p>
                  <p className="mt-1">文件保存、原文读取和风险定位全部完成后，才会创建审核任务。</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="font-medium text-slate-900">上下文来源</p>
                  <p className="mt-1">CRM 对接、报价转合同和文件解析会逐步回填客户、金额、日期和联系人。</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="font-medium text-slate-900">审核依据</p>
                  <p className="mt-1">系统按组织已发布的合同规则集判断风险，模型由管理员统一配置；这里无需选择具体模型。</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <details className="rounded-lg border border-slate-200 bg-white shadow-sm">
            <summary className="cursor-pointer px-6 py-4 text-base font-semibold text-slate-950">
              业务上下文（可选，CRM 或解析未回填时再补充）
            </summary>
            <div className="space-y-5 border-t border-slate-100 px-6 py-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="contract_no">合同编号</Label>
                  <Input
                    id="contract_no"
                    placeholder="留空自动生成"
                    value={form.contract_no}
                    onChange={e => handleInputChange('contract_no', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="party_a_name">甲方（我方）</Label>
                  <Input
                    id="party_a_name"
                    placeholder="我方公司名称"
                    value={form.party_a_name}
                    onChange={e => handleInputChange('party_a_name', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="party_b_name">乙方（客户）</Label>
                  <Input
                    id="party_b_name"
                    placeholder="可由 CRM 或文件解析补齐"
                    value={form.party_b_name}
                    onChange={e => handleInputChange('party_b_name', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="party_b_contact">乙方联系人</Label>
                  <Input
                    id="party_b_contact"
                    placeholder="姓名/电话/邮箱"
                    value={form.party_b_contact}
                    onChange={e => handleInputChange('party_b_contact', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="contract_amount">合同金额（元）</Label>
                  <Input
                    id="contract_amount"
                    type="number"
                    min={0}
                    placeholder="0.00"
                    value={form.contract_amount}
                    onChange={e => handleInputChange('contract_amount', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tax_amount">税额（元）</Label>
                  <Input
                    id="tax_amount"
                    type="number"
                    min={0}
                    placeholder="0.00"
                    value={form.tax_amount}
                    onChange={e => handleInputChange('tax_amount', e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="contract_date">签约日期</Label>
                  <Input
                    id="contract_date"
                    type="date"
                    value={form.contract_date}
                    onChange={e => handleInputChange('contract_date', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="effective_date">生效日期</Label>
                  <Input
                    id="effective_date"
                    type="date"
                    value={form.effective_date}
                    onChange={e => handleInputChange('effective_date', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="expiry_date">到期日期</Label>
                  <Input
                    id="expiry_date"
                    type="date"
                    value={form.expiry_date}
                    onChange={e => handleInputChange('expiry_date', e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="payment_terms">付款条款</Label>
                <Textarea
                  id="payment_terms"
                  placeholder="如：预付30%，验收后付70%"
                  value={form.payment_terms}
                  onChange={e => handleInputChange('payment_terms', e.target.value)}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="delivery_terms">交付条款</Label>
                <Textarea
                  id="delivery_terms"
                  placeholder="如：签约后30个工作日内完成交付"
                  value={form.delivery_terms}
                  onChange={e => handleInputChange('delivery_terms', e.target.value)}
                  rows={2}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="notes">备注</Label>
                <Textarea
                  id="notes"
                  placeholder="其他需要记录的信息"
                  value={form.notes}
                  onChange={e => handleInputChange('notes', e.target.value)}
                  rows={2}
                />
              </div>
            </div>
          </details>
        </form>
      </div>
    </div>
  )
}

function currentUploadStageLabel(stage: UploadStage) {
  return uploadStages.find((item) => item.value === stage)?.label || '发起审核'
}

function UploadStageList({
  stage,
  active,
  progress,
}: {
  stage: UploadStage
  active: boolean
  progress: number
}) {
  const requiresSourcePreparation = stage === 'awaiting_ocr' || stage === 'awaiting_conversion'
  const currentIndex = requiresSourcePreparation
    ? uploadStages.findIndex((item) => item.value === 'preparing')
    : uploadStages.findIndex((item) => item.value === stage)
  const statusLabel = stage === 'awaiting_ocr'
    ? '需要正文识别'
    : stage === 'awaiting_conversion'
      ? '需要转换为 DOCX'
      : stage === 'done'
        ? '已完成'
        : active
          ? '处理中'
          : '等待上传'
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4" aria-live="polite">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-medium text-slate-900">处理进度</p>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
          {statusLabel}
        </span>
      </div>
      {(stage === 'uploading' || stage === 'preparing') && (
        <div className="mb-4" aria-label={`源文件上传进度 ${progress}%`}>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-indigo-600 transition-[width]"
              style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
            />
          </div>
          <p className="mt-1 text-right text-xs text-slate-500">{progress}%</p>
        </div>
      )}
      <div className="space-y-3">
        {uploadStages.map((item, index) => {
          const completed = currentIndex > index || stage === 'done'
          const current = currentIndex === index && (active || requiresSourcePreparation)
          return (
            <div key={item.value} className="flex gap-3">
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                completed
                  ? 'bg-emerald-600 text-white'
                  : current
                    ? requiresSourcePreparation
                      ? 'bg-amber-500 text-white'
                      : 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-400'
              }`}>
                {completed ? '✓' : index + 1}
              </span>
              <div className="min-w-0">
                <p className={`text-sm font-medium ${current ? requiresSourcePreparation ? 'text-amber-700' : 'text-indigo-700' : 'text-slate-900'}`}>{item.label}</p>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">{item.description}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
