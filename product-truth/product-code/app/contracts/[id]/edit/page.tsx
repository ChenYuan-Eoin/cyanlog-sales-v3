// REQ:F005 - Contract Edit Page
// PURPOSE: Upload contract file, edit metadata, manage contract lifecycle

'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import Link from 'next/link'
import { handleError } from '@/lib/toast'

interface Contract {
  id: string
  contract_no: string | null
  quote_id: string | null
  party_a_name: string | null
  party_b_name: string | null
  party_b_contact: string | null
  contract_amount: number | null
  tax_amount: number | null
  contract_date: string | null
  effective_date: string | null
  expiry_date: string | null
  payment_terms: string | null
  delivery_terms: string | null
  filename: string
  storage_path: string
  status: string
  notes: string | null
  created_at: string
}

interface ContractItem {
  id: string
  name: string
  specification: string | null
  quantity: number
  unit: string | null
  unit_price: number
  line_total: number
}

const statusMap: Record<string, { label: string; className: string }> = {
  DRAFT: { label: '草稿', className: 'bg-slate-100 text-slate-700' },
  PENDING: { label: '待审核', className: 'bg-yellow-100 text-yellow-700' },
  PARSING: { label: '解析中', className: 'bg-blue-100 text-blue-700' },
  ANALYZING: { label: '审核中', className: 'bg-blue-100 text-blue-700' },
  COMPLETED: { label: '审核完成', className: 'bg-green-100 text-green-700' },
  FAILED: { label: '审核失败', className: 'bg-red-100 text-red-700' },
}

const ALLOWED_REVIEW_EXTENSIONS = ['.pdf', '.docx']

function validateReviewFile(file: File): string | null {
  const extension = `.${file.name.split('.').pop()?.toLowerCase() || ''}`
  if (!ALLOWED_REVIEW_EXTENSIONS.includes(extension)) {
    return `不支持的文件类型: ${extension}，请上传 PDF 或 DOCX 文件`
  }
  if (file.size > 50 * 1024 * 1024) {
    return `文件大小超过 50MB 限制: ${(file.size / 1024 / 1024).toFixed(2)} MB`
  }
  return null
}

export default function ContractEditPage() {
  const params = useParams()
  const router = useRouter()
  const contractId = params.id as string

  const [contract, setContract] = useState<Contract | null>(null)
  const [items, setItems] = useState<ContractItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Form state
  const [formData, setFormData] = useState<Partial<Contract>>({})

  const fetchContract = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        setError('获取合同失败')
        return
      }

      const data = await res.json()
      setContract(data)
      setFormData({
        contract_no: data.contract_no || '',
        party_a_name: data.party_a_name || '',
        party_b_name: data.party_b_name || '',
        party_b_contact: data.party_b_contact || '',
        contract_amount: data.contract_amount || 0,
        tax_amount: data.tax_amount || 0,
        contract_date: data.contract_date || '',
        effective_date: data.effective_date || '',
        expiry_date: data.expiry_date || '',
        payment_terms: data.payment_terms || '',
        delivery_terms: data.delivery_terms || '',
        notes: data.notes || '',
      })
    } catch {
      setError('网络错误')
    } finally {
      setLoading(false)
    }
  }, [contractId])

  const fetchItems = useCallback(async () => {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}/items`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (res.ok) {
        const data = await res.json()
        setItems(data.data || [])
      }
    } catch (err) {
      handleError(err, '加载合同数据失败')
    }
  }, [contractId])

  useEffect(() => {
    void fetchContract()
    void fetchItems()
  }, [fetchContract, fetchItems])

  async function handleSave() {
    setSaving(true)
    setError('')
    setSuccess('')

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}`, {
        method: 'PATCH',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(formData),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '保存失败')
        return
      }

      setSuccess('保存成功')
      await fetchContract()
    } catch {
      setError('网络错误')
    } finally {
      setSaving(false)
    }
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    const validationError = validateReviewFile(file)
    if (validationError) {
      setError(validationError)
      e.target.value = ''
      return
    }

    setUploading(true)
    setError('')

    try {
      const token = localStorage.getItem('token')
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`/api/contracts/${contractId}/upload`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: formData,
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '上传失败')
        return
      }

      setSuccess('上传成功')
      await fetchContract()
    } catch {
      setError('网络错误')
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmitForReview() {
    setSaving(true)
    setError('')

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/contracts/${contractId}/submit`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || '提交失败')
        return
      }

      router.push(`/contracts/${contractId}`)
    } catch {
      setError('网络错误')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-8">
        <div className="text-slate-500">加载中...</div>
      </div>
    )
  }

  if (!contract) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-slate-500 mb-4">合同不存在</p>
            <Link href="/contracts">
              <Button variant="outline">返回列表</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  const hasFile = contract.filename && contract.storage_path

  return (
    <div className="p-8 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-sm text-slate-500 mb-1">
            <Link href="/contracts" className="hover:underline">合同审核</Link>
            <span className="mx-2">/</span>
            <Link href={`/contracts/${contractId}`} className="hover:underline">详情</Link>
            <span className="mx-2">/</span>
            <span>编辑</span>
          </div>
          <h1 className="text-2xl font-bold">合同版本与信息</h1>
        </div>
        <div className="flex gap-2">
          <Link href={`/contracts/${contractId}`}>
            <Button variant="outline">取消</Button>
          </Link>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded text-sm text-green-700">
          {success}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Main Form */}
        <div className="lg:col-span-2 space-y-6">
          <Tabs defaultValue="basic">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="basic">基本信息</TabsTrigger>
              <TabsTrigger value="terms">条款</TabsTrigger>
              <TabsTrigger value="items">标的明细</TabsTrigger>
            </TabsList>

            <TabsContent value="basic" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">合同主体</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">合同编号</label>
                      <Input
                        value={formData.contract_no || ''}
                        onChange={(e) => setFormData({ ...formData, contract_no: e.target.value })}
                        placeholder="自动生成"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">状态</label>
                      <div className="pt-2">
                        <Badge className={statusMap[contract.status]?.className}>
                          {statusMap[contract.status]?.label || contract.status}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">甲方（我方）</label>
                      <Input
                        value={formData.party_a_name || ''}
                        onChange={(e) => setFormData({ ...formData, party_a_name: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">乙方（客户）</label>
                      <Input
                        value={formData.party_b_name || ''}
                        onChange={(e) => setFormData({ ...formData, party_b_name: e.target.value })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-sm font-medium">乙方联系人</label>
                    <Input
                      value={formData.party_b_contact || ''}
                      onChange={(e) => setFormData({ ...formData, party_b_contact: e.target.value })}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">合同日期</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="text-sm font-medium">签约日期</label>
                      <Input
                        type="date"
                        value={formData.contract_date || ''}
                        onChange={(e) => setFormData({ ...formData, contract_date: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">生效日期</label>
                      <Input
                        type="date"
                        value={formData.effective_date || ''}
                        onChange={(e) => setFormData({ ...formData, effective_date: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">到期日期</label>
                      <Input
                        type="date"
                        value={formData.expiry_date || ''}
                        onChange={(e) => setFormData({ ...formData, expiry_date: e.target.value })}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">金额</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">合同金额（元）</label>
                      <Input
                        type="number"
                        value={formData.contract_amount || ''}
                        onChange={(e) => setFormData({ ...formData, contract_amount: parseFloat(e.target.value) })}
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">税额（元）</label>
                      <Input
                        type="number"
                        value={formData.tax_amount || ''}
                        onChange={(e) => setFormData({ ...formData, tax_amount: parseFloat(e.target.value) })}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="terms" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">条款</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label className="text-sm font-medium">付款条款</label>
                    <Textarea
                      rows={4}
                      value={formData.payment_terms || ''}
                      onChange={(e) => setFormData({ ...formData, payment_terms: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">交付条款</label>
                    <Textarea
                      rows={4}
                      value={formData.delivery_terms || ''}
                      onChange={(e) => setFormData({ ...formData, delivery_terms: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">备注</label>
                    <Textarea
                      rows={3}
                      value={formData.notes || ''}
                      onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="items" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">标的明细</CardTitle>
                </CardHeader>
                <CardContent>
                  {items.length === 0 ? (
                    <p className="text-slate-500 text-sm">暂无标的明细</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 text-left">标的名称</th>
                          <th className="px-3 py-2 text-left">规格</th>
                          <th className="px-3 py-2 text-right">数量</th>
                          <th className="px-3 py-2 text-right">单价</th>
                          <th className="px-3 py-2 text-right">小计</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => (
                          <tr key={item.id} className="border-t">
                            <td className="px-3 py-2">{item.name}</td>
                            <td className="px-3 py-2">{item.specification || '-'}</td>
                            <td className="px-3 py-2 text-right">{item.quantity}</td>
                            <td className="px-3 py-2 text-right">¥{item.unit_price?.toLocaleString()}</td>
                            <td className="px-3 py-2 text-right">¥{item.line_total?.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Right: Actions */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">合同源文件与客户回传版</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {hasFile ? (
                <div>
                  <p className="text-sm font-medium">{contract.filename}</p>
                  <p className="text-xs text-slate-500">当前审核源文件</p>
                </div>
              ) : (
                <p className="text-sm text-slate-500">尚未上传合同源文件</p>
              )}
              <label className={uploading ? 'block cursor-not-allowed opacity-60' : 'block cursor-pointer'}>
                <input
                  type="file"
                  accept=".pdf,.docx"
                  onChange={handleFileUpload}
                  className="hidden"
                  disabled={uploading}
                />
                <span className="inline-flex h-8 w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50">
                  {uploading ? '上传中...' : hasFile ? '上传客户回传版' : '补充合同源文件'}
                </span>
              </label>
            </CardContent>
          </Card>

          {contract.status === 'DRAFT' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">提交审核</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-slate-500 mb-3">
                  提交后合同将进入AI审核流程
                </p>
                <Button
                  className="w-full"
                  disabled={!hasFile || saving}
                  onClick={handleSubmitForReview}
                >
                  {saving ? '提交中...' : '提交审核'}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
