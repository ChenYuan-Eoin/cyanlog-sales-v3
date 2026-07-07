'use client'

import { useCallback, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  reviewStyleLabel,
  reviewStyleOptions,
  reviewStyleStrategy,
  type ReviewStyle,
} from '@/lib/contracts/review-style'

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

type UploadStage = 'idle' | 'creating' | 'uploading' | 'submitting' | 'analyzing' | 'done'

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

const ALLOWED_EXTENSIONS = ['.pdf', '.docx']

const uploadStages: Array<{ value: UploadStage; label: string; description: string }> = [
  { value: 'creating', label: '创建合同任务', description: '生成合同记录和版本容器' },
  { value: 'uploading', label: '上传源文件', description: '保存原始 DOCX/PDF，不重排文件格式' },
  { value: 'submitting', label: '提交审核', description: '形成可审核合同版本' },
  { value: 'analyzing', label: '启动审核运行', description: '绑定发布规则和模型策略' },
  { value: 'done', label: '进入工作台', description: '跳转到风险定位与批注工作台' },
]

function validateReviewFile(file: File): string | null {
  const extension = `.${file.name.split('.').pop()?.toLowerCase() || ''}`
  if (!ALLOWED_EXTENSIONS.includes(extension)) {
    return `不支持的文件类型: ${extension}，请上传 PDF 或 DOCX 文件`
  }
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

function buildContractPayload(form: ContractForm, file: File, reviewStyle: ReviewStyle) {
  const notes = [
    optionalText(form.notes),
    `审核源文件: ${file.name}`,
    `审核风格: ${reviewStyleLabel(reviewStyle)}`,
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

export default function NewContractPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<ContractForm>(initialForm)
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [stage, setStage] = useState<UploadStage>('idle')
  const [error, setError] = useState('')
  const [reviewStyle, setReviewStyle] = useState<ReviewStyle>('balanced')

  const handleInputChange = useCallback((field: keyof ContractForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
    setError('')
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

  async function submitContractForReview(cid: string, token: string) {
    const res = await fetch(`/api/contracts/${cid}/submit`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(readApiError(data, '提交审核失败'))
    }
  }

  async function startContractAnalysis(cid: string, token: string, style: ReviewStyle) {
    const res = await fetch(`/api/contracts/${cid}/analyze`, {
      method: 'POST',
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ strategy: reviewStyleStrategy(style) }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(readApiError(data, '启动审核失败'))
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

    try {
      const token = localStorage.getItem('token')
      if (!token) {
        setError('请先登录')
        setLoading(false)
        return
      }

      setStage('creating')
      const createRes = await fetch('/api/contracts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(buildContractPayload(form, file, reviewStyle)),
      })
      const createData = await createRes.json().catch(() => ({}))
      if (!createRes.ok) {
        setError(readApiError(createData, '创建审核任务失败'))
        setLoading(false)
        return
      }

      const contractId =
        createData?.data?.contract_id ||
        createData?.contract_id ||
        createData?.data?.id ||
        createData?.id
      if (!contractId) {
        setError('创建成功但未返回合同ID')
        setLoading(false)
        return
      }

      const formData = new FormData()
      formData.append('file', file)

      setStage('uploading')
      const uploadRes = await fetch(`/api/contracts/${contractId}/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })

      if (!uploadRes.ok) {
        const data = await uploadRes.json().catch(() => ({}))
        setError(readApiError(data, '文件上传失败'))
        setLoading(false)
        return
      }

      setStage('submitting')
      await submitContractForReview(contractId, token)
      setStage('analyzing')
      await startContractAnalysis(contractId, token, reviewStyle)

      setStage('done')
      router.push(`/contracts/${contractId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误，请稍后重试')
      setLoading(false)
      setStage('idle')
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
                先上传合同源文件形成可审核版本，客户、金额、日期等业务上下文可由 CRM 或文件解析回填。
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
                  accept=".pdf,.docx"
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
                        DOC
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
                        <p className="mt-1 text-sm text-slate-500">支持 PDF、DOCX，最大 50MB</p>
                      </div>
                      <Button type="button" variant="outline" size="sm">
                        选择文件
                      </Button>
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-900">审核风格</p>
                    <Badge variant="outline">随本次 ReviewRun 生效</Badge>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-3">
                    {reviewStyleOptions.map((option) => {
                      const active = option.value === reviewStyle
                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setReviewStyle(option.value)}
                          className={`rounded-md border px-3 py-2 text-left transition ${
                            active
                              ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-blue-200'
                          }`}
                        >
                          <span className="text-sm font-semibold">{option.label}</span>
                          <span className={`mt-1 block text-xs leading-5 ${active ? 'text-slate-200' : 'text-slate-500'}`}>
                            {option.description}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row">
	                  <Button type="submit" disabled={!file || loading} className="sm:min-w-48">
	                    {loading ? `${currentUploadStageLabel(stage)}…` : '上传源文件并发起审核'}
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
	                <UploadStageList stage={stage} active={loading} />
	                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
	                  <p className="font-medium text-slate-900">当前阶段</p>
                  <p className="mt-1">文件先行，先创建合同版本与审核任务，再进入合同工作台。</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="font-medium text-slate-900">上下文来源</p>
                  <p className="mt-1">CRM 对接、报价转合同和文件解析会逐步回填客户、金额、日期和联系人。</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="font-medium text-slate-900">审核依据</p>
                  <p className="mt-1">进入审核后按已发布规则和模型策略执行，不依赖临时输入文本。</p>
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
}: {
  stage: UploadStage
  active: boolean
}) {
  const currentIndex = uploadStages.findIndex((item) => item.value === stage)
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4" aria-live="polite">
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="font-medium text-slate-900">处理进度</p>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
          {active ? '运行中' : '等待上传'}
        </span>
      </div>
      <div className="space-y-3">
        {uploadStages.map((item, index) => {
          const completed = currentIndex > index || stage === 'done'
          const current = active && currentIndex === index
          return (
            <div key={item.value} className="flex gap-3">
              <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
                completed
                  ? 'bg-emerald-600 text-white'
                  : current
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-400'
              }`}>
                {completed ? '✓' : index + 1}
              </span>
              <div className="min-w-0">
                <p className={`text-sm font-medium ${current ? 'text-indigo-700' : 'text-slate-900'}`}>{item.label}</p>
                <p className="mt-0.5 text-xs leading-5 text-slate-500">{item.description}</p>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
