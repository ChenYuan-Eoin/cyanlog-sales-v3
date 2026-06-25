'use client'

import { useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import Link from 'next/link'

// 合同上传 — 完整信息录入 + 文件上传（分两阶段）
// Phase 1: 录入合同信息 → POST /api/contracts 创建
// Phase 2: 上传文件 → 自动跳转到详情页并触发审核

type Phase = 'info' | 'file' | 'done'

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

export default function NewContractPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<Phase>('info')
  const [contractId, setContractId] = useState<string | null>(null)
  const [form, setForm] = useState<ContractForm>(initialForm)
  const [file, setFile] = useState<File | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleInputChange = useCallback((field: keyof ContractForm, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }))
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
      setFile(e.dataTransfer.files[0])
      setError('')
    }
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      setFile(e.target.files[0])
      setError('')
    }
  }

  async function handleCreateContract(e: React.FormEvent) {
    e.preventDefault()
    if (!form.party_b_name) {
      setError('乙方名称不能为空')
      return
    }

    setLoading(true)
    setError('')

    try {
      const token = localStorage.getItem('token')
      const payload = {
        ...form,
        contract_amount: form.contract_amount ? Number(form.contract_amount) : undefined,
        tax_amount: form.tax_amount ? Number(form.tax_amount) : undefined,
        contract_date: form.contract_date || undefined,
        effective_date: form.effective_date || undefined,
        expiry_date: form.expiry_date || undefined,
      }

      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(payload),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(readApiError(data, '创建失败'))
        setLoading(false)
        return
      }

      const createdContractId = data?.data?.contract_id || data?.contract_id || data?.data?.id || data?.id
      if (!createdContractId) {
        setError('创建成功但未返回合同ID')
        setLoading(false)
        return
      }

      setContractId(createdContractId)
      setPhase('file')
    } catch {
      setError('网络错误，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  async function handleUploadAndStart() {
    if (!file || !contractId) {
      setError('请选择合同文件')
      return
    }

    setLoading(true)
    setError('')

    try {
      const token = localStorage.getItem('token')
      const formData = new FormData()
      formData.append('file', file)

      // 上传文件
      const uploadRes = await fetch(`/api/contracts/${contractId}/upload`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      })

      if (!uploadRes.ok) {
        const data = await uploadRes.json().catch(() => ({}))
        setError(readApiError(data, '文件上传失败'))
        setLoading(false)
        return
      }

      // 跳转到详情页
      router.push(`/contracts/${contractId}`)
    } catch {
      setError('网络错误，请稍后重试')
      setLoading(false)
    }
  }

  // ───────────────────────────────────────────
  // Phase 1: 合同信息录入
  // ───────────────────────────────────────────
  if (phase === 'info') {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="mb-6 flex items-center gap-2">
          <Badge variant="outline">Step 1/2</Badge>
          <span className="text-sm text-slate-500">录入合同信息</span>
        </div>

        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">创建合同</h1>
          <Link href="/contracts">
            <Button variant="outline" size="sm">返回列表</Button>
          </Link>
        </div>

        {error && (
          <Card className="mb-4 border-red-200">
            <CardContent className="py-3">
              <p className="text-sm text-red-600">{error}</p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>合同基本信息</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateContract} className="space-y-5">
              {/* 编号 + 甲方 */}
              <div className="grid grid-cols-2 gap-4">
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

              {/* 乙方 + 联系人 */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="party_b_name">
                    乙方（客户）<span className="text-red-500 ml-1">*</span>
                  </Label>
                  <Input
                    id="party_b_name"
                    placeholder="客户公司名称"
                    value={form.party_b_name}
                    onChange={e => handleInputChange('party_b_name', e.target.value)}
                    required
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

              {/* 金额 */}
              <div className="grid grid-cols-2 gap-4">
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

              {/* 日期 */}
              <div className="grid grid-cols-3 gap-4">
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

              {/* 条款 */}
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

              <div className="flex gap-4 pt-2">
                <Button type="submit" disabled={loading}>
                  {loading ? '创建中...' : '下一步：上传合同文件'}
                </Button>
                <Button type="button" variant="outline" onClick={() => router.push('/contracts')}>
                  取消
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  // ───────────────────────────────────────────
  // Phase 2: 文件上传
  // ───────────────────────────────────────────
  return (
    <div className="p-8 max-w-2xl mx-auto">
      <div className="mb-6 flex items-center gap-2">
        <Badge variant="outline">Step 2/2</Badge>
        <span className="text-sm text-slate-500">上传合同文件</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">上传合同文件</h1>
        <button
          onClick={() => {
            setPhase('info')
            setFile(null)
            setError('')
          }}
          className="text-sm text-slate-500 hover:text-slate-700 underline"
        >
          ← 返回修改信息
        </button>
      </div>

      {/* 已录入信息预览 */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-slate-500">已录入信息</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div><span className="text-slate-500">乙方：</span>{form.party_b_name}</div>
            {form.party_a_name && <div><span className="text-slate-500">甲方：</span>{form.party_a_name}</div>}
            {form.contract_amount && (
              <div><span className="text-slate-500">金额：</span>
                ¥{Number(form.contract_amount).toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
              </div>
            )}
            {form.contract_date && <div><span className="text-slate-500">签约日：</span>{form.contract_date}</div>}
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="mb-4 border-red-200">
          <CardContent className="py-3">
            <p className="text-sm text-red-600">{error}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>合同文件</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-10 text-center transition-colors ${
              dragActive ? 'border-blue-500 bg-blue-50' : 'border-slate-300'
            } ${file ? 'border-green-500 bg-green-50' : ''}`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.doc"
              onChange={handleFileChange}
              className="hidden"
              id="contract-file"
            />
            <label htmlFor="contract-file" className="cursor-pointer block">
              {file ? (
                <div className="space-y-2">
                  <div className="text-lg font-medium text-green-700">{file.name}</div>
                  <div className="text-sm text-slate-500">
                    {(file.size / 1024 / 1024).toFixed(2)} MB · {file.type || '未知类型'}
                  </div>
                  <button
                    type="button"
                    onClick={e => {
                      e.preventDefault()
                      setFile(null)
                      if (fileInputRef.current) fileInputRef.current.value = ''
                    }}
                    className="text-sm text-slate-400 hover:text-red-500 underline mt-2"
                  >
                    重新选择
                  </button>
                </div>
              ) : (
                <div>
                  <div className="text-4xl mb-3">📄</div>
                  <p className="text-slate-600 font-medium mb-1">拖拽合同文件到此处</p>
                  <p className="text-xs text-slate-400 mb-3">或点击选择文件</p>
                  <p className="text-xs text-slate-400">支持 PDF、Word 文档，最大 50MB</p>
                </div>
              )}
            </label>
          </div>

          <div className="flex gap-4">
            <Button
              onClick={handleUploadAndStart}
              disabled={!file || loading}
            >
              {loading ? '上传中...' : '上传并提交审核'}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setFile(null)
                if (fileInputRef.current) fileInputRef.current.value = ''
              }}
              disabled={!file}
            >
              清除文件
            </Button>
          </div>

          <p className="text-xs text-slate-400">
            上传后将自动解析合同文本并启动AI审核，预计 30 秒完成。
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
