'use client'

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircle2Icon,
  FileArchiveIcon,
  FileTextIcon,
  GitCompareIcon,
  Loader2Icon,
  ShieldCheckIcon,
  UploadIcon,
  XIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useChunkUpload, type UploadState } from '@/lib/hooks/useChunkUpload'
import { contractSourceFormatFromFilename } from '@/lib/documents/source-format'
import { CONTRACT_UPLOAD_MAX_BYTES } from '@/lib/documents/chunk-upload-protocol'
import { createdContractId } from '@/lib/documents/upload-queue'
import { readUploadErrorMessage } from '@/lib/documents/upload-error'
import { cn } from '@/lib/utils'

type Role = 'old' | 'new'
const G6_SOURCE_ACCEPT = '.pdf,.docx,.docm'

interface UploadResult {
  fileUrl: string
  storagePath: string
  contractId: string
  fileName: string
  uploadId: string
  sha256: string
}

interface RoleState {
  file: File | null
  contractId: string | null
  result: UploadResult | null
}

function validateFile(file: File) {
  const format = contractSourceFormatFromFilename(file.name)
  if (format === 'doc') return '旧版 DOC 无法可靠提取原文，请先在 Word/WPS 另存为 DOCX'
  if (format !== 'pdf' && format !== 'docx' && format !== 'docm') return '仅支持 PDF、DOCX、DOCM 文件'
  if (file.size < 1) return '文件为空'
  if (file.size > CONTRACT_UPLOAD_MAX_BYTES) return '文件超过 50MB 免费主线上限'
  return null
}

function resultMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') return fallback
  const error = (payload as { error?: string | { message?: string } }).error
  if (typeof error === 'string') return error || fallback
  return error?.message || fallback
}

async function createComparisonContract(role: Role, file: File, token: string) {
  const response = await fetch('/api/contracts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      party_b_name: `${role === 'old' ? '旧文件' : '新文件'} · ${file.name.replace(/\.[^/.]+$/, '')}`,
      contract_amount: 0,
      notes: `G6 文档对比内部源文件角色：${role}`,
    }),
  })
  if (!response.ok) throw new Error(await readUploadErrorMessage(response, `创建${role === 'old' ? '旧' : '新'}文件记录失败`))
  const payload = await response.json()
  const id = createdContractId(payload)
  if (!id) throw new Error('创建文件记录失败：未返回合同 ID')
  return id
}

function FileRoleCard({
  role,
  state,
  uploadState,
  disabled,
  onSelect,
  onClear,
}: {
  role: Role
  state: RoleState
  uploadState: UploadState
  disabled: boolean
  onSelect: (file: File) => void
  onClear: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const label = role === 'old' ? '旧文件' : '新文件'
  const description = role === 'old' ? '作为修改前基准原件' : '客户回传或修改后的原件'
  const color = role === 'old' ? 'red' : 'emerald'
  const isComplete = Boolean(state.result)
  const isUploading = uploadState.status === 'uploading'

  return (
    <section className={cn('relative rounded-2xl border-2 bg-white p-5 shadow-sm', role === 'old' ? 'border-red-200' : 'border-emerald-200')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className={cn('rounded-xl p-3', role === 'old' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700')}>
            {state.file?.name.toLowerCase().endsWith('.pdf') ? <FileTextIcon className="size-6" /> : <FileArchiveIcon className="size-6" />}
          </div>
          <div>
            <div className="flex items-center gap-2"><Badge className={color === 'red' ? 'bg-red-600' : 'bg-emerald-600'}>{label}</Badge>{isComplete && <CheckCircle2Icon className="size-4 text-emerald-600" />}</div>
            <p className="mt-2 text-sm font-semibold text-slate-900">{state.file?.name || description}</p>
            <p className="mt-1 text-xs text-slate-500">{state.file ? `${(state.file.size / 1024 / 1024).toFixed(2)} MB` : '支持 DOCX、DOCM、文本/扫描 PDF，单文件 50MB'}</p>
          </div>
        </div>
        {state.file && !disabled && <Button variant="ghost" size="icon-sm" onClick={onClear} aria-label={`清除${label}`}><XIcon /></Button>}
      </div>

      {isUploading && (
        <div className="mt-5">
          <div className="mb-1 flex justify-between text-[11px] text-slate-500"><span>正在上传并验证源文件摘要</span><span>{uploadState.progress}%</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-indigo-600 transition-[width]" style={{ width: `${uploadState.progress}%` }} /></div>
        </div>
      )}
      {uploadState.status === 'error' && <p className="mt-4 text-xs text-red-700">{uploadState.error}</p>}
      {state.result && <p className="mt-4 break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-[10px] text-slate-600">SHA-256 {state.result.sha256}</p>}

      <input
        ref={inputRef}
        type="file"
        accept={G6_SOURCE_ACCEPT}
        className="hidden"
        disabled={disabled}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) onSelect(file)
          event.target.value = ''
        }}
      />
      {!state.file && <Button variant="outline" className="mt-5 w-full" disabled={disabled} onClick={() => inputRef.current?.click()}><UploadIcon />选择{label}</Button>}
    </section>
  )
}

export default function ContractCompareEntryPage() {
  const router = useRouter()
  const [roles, setRoles] = useState<Record<Role, RoleState>>({
    old: { file: null, contractId: null, result: null },
    new: { file: null, contractId: null, result: null },
  })
  const rolesRef = useRef(roles)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const oldResolveRef = useRef<((result: UploadResult) => void) | null>(null)
  const oldRejectRef = useRef<((error: Error) => void) | null>(null)
  const newResolveRef = useRef<((result: UploadResult) => void) | null>(null)
  const newRejectRef = useRef<((error: Error) => void) | null>(null)

  const updateRole = useCallback((role: Role, next: RoleState) => {
    const updated = { ...rolesRef.current, [role]: next }
    rolesRef.current = updated
    setRoles(updated)
  }, [])

  const oldUpload = useChunkUpload({
    onComplete: (result) => {
      const current = rolesRef.current.old
      updateRole('old', { ...current, result })
      oldResolveRef.current?.(result)
      oldResolveRef.current = null
      oldRejectRef.current = null
    },
    onError: (message) => {
      oldRejectRef.current?.(new Error(message))
      oldResolveRef.current = null
      oldRejectRef.current = null
    },
  })
  const newUpload = useChunkUpload({
    onComplete: (result) => {
      const current = rolesRef.current.new
      updateRole('new', { ...current, result })
      newResolveRef.current?.(result)
      newResolveRef.current = null
      newRejectRef.current = null
    },
    onError: (message) => {
      newRejectRef.current?.(new Error(message))
      newResolveRef.current = null
      newRejectRef.current = null
    },
  })

  const selectFile = useCallback((role: Role, file: File) => {
    const validation = validateFile(file)
    if (validation) {
      setError(`${file.name}：${validation}`)
      return
    }
    setError('')
    updateRole(role, { file, contractId: null, result: null })
  }, [updateRole])

  const uploadRole = useCallback(async (role: Role, token: string) => {
    const current = rolesRef.current[role]
    if (!current.file) throw new Error(`请先选择${role === 'old' ? '旧' : '新'}文件`)
    if (current.result) return current.result
    const contractId = current.contractId || await createComparisonContract(role, current.file, token)
    updateRole(role, { ...rolesRef.current[role], contractId })

    return await new Promise<UploadResult>((resolve, reject) => {
      if (role === 'old') {
        oldResolveRef.current = resolve
        oldRejectRef.current = reject
        void oldUpload.startUpload(current.file as File, contractId, token)
      } else {
        newResolveRef.current = resolve
        newRejectRef.current = reject
        void newUpload.startUpload(current.file as File, contractId, token)
      }
    })
  }, [newUpload, oldUpload, updateRole])

  const startComparison = useCallback(async () => {
    if (running) return
    const token = localStorage.getItem('token')
    if (!token) {
      setError('请先登录')
      return
    }
    if (!rolesRef.current.old.file || !rolesRef.current.new.file) {
      setError('请分别选择旧文件和新文件')
      return
    }

    setRunning(true)
    setError('')
    try {
      const oldResult = await uploadRole('old', token)
      const newResult = await uploadRole('new', token)
      const response = await fetch(`/api/contracts/${oldResult.contractId}/compare`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseline_type: 'uploaded',
          baseline_doc_id: oldResult.contractId,
          compare_doc_id: newResult.contractId,
        }),
      })
      const payload = await response.json().catch(() => null)
      const comparisonId = payload?.data?.id || payload?.error?.details?.comparison_id
      if (!response.ok && !comparisonId) throw new Error(resultMessage(payload, '创建比对失败'))
      if (!comparisonId) throw new Error('创建比对失败：未返回比对 ID')
      router.push(`/contracts/${oldResult.contractId}/compare?comparison_id=${comparisonId}`)
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : '创建比对失败')
      setRunning(false)
    }
  }, [router, running, uploadRole])

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
      <div className="mx-auto max-w-6xl">
        <Link href="/contracts"><Button variant="ghost" size="sm"><ArrowLeftIcon />返回合同中心</Button></Link>
        <div className="mt-6 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <div className="flex items-center gap-2 text-indigo-700"><GitCompareIcon className="size-6" /><span className="text-sm font-semibold">G6 文档对比</span></div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">上传旧文件和新文件</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">系统在比对创建时冻结两份原文件的路径、文件 SHA、文本 SHA 和页级映射。后续合同变化不会改写历史结果。</p>
          </div>
          <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"><ShieldCheckIcon className="size-4" />免费主线 · 无在线 Office 依赖</div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
          <FileRoleCard role="old" state={roles.old} uploadState={oldUpload.state} disabled={running} onSelect={(file) => selectFile('old', file)} onClear={() => updateRole('old', { file: null, contractId: null, result: null })} />
          <div className="flex items-center justify-center"><div className="rounded-full border border-slate-200 bg-white p-3 text-slate-500 shadow-sm"><ArrowRightIcon className="size-5 rotate-90 md:rotate-0" /></div></div>
          <FileRoleCard role="new" state={roles.new} uploadState={newUpload.state} disabled={running} onSelect={(file) => selectFile('new', file)} onClear={() => updateRole('new', { file: null, contractId: null, result: null })} />
        </div>

        {error && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</div>}

        <div className="mt-7 flex flex-col items-center gap-3">
          <Button size="lg" className="min-w-56" disabled={running || !roles.old.file || !roles.new.file} onClick={() => void startComparison()}>
            {running ? <Loader2Icon className="animate-spin" /> : <GitCompareIcon />}{running ? '正在冻结并比对…' : '开始文档对比'}
          </Button>
          <p className="text-center text-xs text-slate-500">文本 PDF 与 DOCX/DOCM 进入完整差异链；扫描 PDF 没有可靠文本时仍可原文预览，但会明确停止差异与报告。</p>
        </div>
      </div>
    </main>
  )
}
