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

export default function NewContractPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [form, setForm] = useState<ContractForm>(initialForm)
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

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

  async function startContractAnalysis(cid: string, token: string) {
    const res = await fetch(`/api/contracts/${cid}/analyze`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
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

      const createRes = await fetch('/api/contracts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(buildContractPayload(form, file)),
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

      await submitContractForReview(contractId, token)
      await startContractAnalysis(contractId, token)

      router.push(`/contracts/${contractId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络错误，请稍后重试')
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
              <p className="text-sm font-medium text-red-700">{error}</p>
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

                <div className="flex flex-col gap-3 sm:flex-row">
                  <Button type="submit" disabled={!file || loading} className="sm:min-w-48">
                    {loading ? '正在发起审核...' : '上传源文件并发起审核'}
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
                <CardTitle>审核上下文</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm text-slate-600">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="font-medium text-slate-900">当前阶段</p>
                  <p className="mt-1">文件先行，先创建 ContractVersion 与 ReviewRun，再进入合同工作台。</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="font-medium text-slate-900">上下文来源</p>
                  <p className="mt-1">CRM 对接、报价转合同和文件解析会逐步回填客户、金额、日期和联系人。</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="font-medium text-slate-900">审核依据</p>
                  <p className="mt-1">进入审核后按已发布规则、SkillBundle 和模型策略执行，不依赖临时输入文本。</p>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>业务上下文（可选）</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
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
            </CardContent>
          </Card>
        </form>
      </div>
    </div>
  )
}
