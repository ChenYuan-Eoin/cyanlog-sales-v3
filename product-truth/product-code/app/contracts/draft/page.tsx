// REQ:F005 - 合同起草页面
// PURPOSE: 独立创建合同草稿，可选引用报价数据作为合同章节

'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { LoaderIcon, PlusIcon, FileTextIcon, LinkIcon, XIcon } from 'lucide-react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'

interface QuoteOption {
  id: string
  quote_no: string
  customer_name: string
  total_amount: number
  status: string
}

interface QuoteItem {
  name: string
  quantity: number
  unit_price: number
  line_total: number
}

export default function ContractDraftPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const prefillQuoteId = searchParams.get('quote_id')

  // 表单状态
  const [partyAName, setPartyAName] = useState('')
  const [partyBName, setPartyBName] = useState('')
  const [partyBContact, setPartyBContact] = useState('')
  const [contractAmount, setContractAmount] = useState('')
  const [taxAmount, setTaxAmount] = useState('')
  const [paymentTerms, setPaymentTerms] = useState('')
  const [deliveryTerms, setDeliveryTerms] = useState('')
  const [contractDate, setContractDate] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const [expiryDate, setExpiryDate] = useState('')
  const [notes, setNotes] = useState('')

  // 报价引用
  const [quotes, setQuotes] = useState<QuoteOption[]>([])
  const [selectedQuoteId, setSelectedQuoteId] = useState<string>(prefillQuoteId || '')
  const [selectedQuoteItems, setSelectedQuoteItems] = useState<QuoteItem[]>([])
  const [includeQuoteItems, setIncludeQuoteItems] = useState(true)

  // UI 状态
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [quotesLoading, setQuotesLoading] = useState(true)

  // 加载可引用的报价列表（已确认状态）
  useEffect(() => {
    async function loadQuotes() {
      try {
        const token = localStorage.getItem('token')
        const res = await fetch('/api/quotes?status=CONFIRMED&pageSize=50', {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        })
        if (res.ok) {
          const data = await res.json()
          const list = data.data?.quotes || data.quotes || []
          setQuotes(list)

          // 如果有预填充的 quote_id，自动加载
          if (prefillQuoteId) {
            loadQuoteDetails(prefillQuoteId)
          }
        }
      } catch {
        // ignore
      } finally {
        setQuotesLoading(false)
      }
    }

    void loadQuotes()
  }, [prefillQuoteId])

  // 加载报价详情
  async function loadQuoteDetails(quoteId: string) {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/quotes/${quoteId}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })
      if (res.ok) {
        const data = await res.json()
        const quote = data.data || data

        // 自动填充客户信息
        setPartyBName(quote.customer_name || '')
        setPartyBContact(quote.customer_contact || '')
        setContractAmount(String(quote.total_amount || ''))
        setTaxAmount(String(quote.tax_amount || ''))
        setPaymentTerms(quote.payment_terms || '')

        // 加载报价明细
        if (quote.quote_items) {
          setSelectedQuoteItems(quote.quote_items.map((item: any) => ({
            name: item.name,
            quantity: item.quantity,
            unit_price: item.unit_price,
            line_total: item.line_total,
          })))
        }
      }
    } catch {
      // ignore
    }
  }

  // 选择报价时填充数据
  function handleQuoteSelect(quoteId: string) {
    setSelectedQuoteId(quoteId)
    if (quoteId) {
      loadQuoteDetails(quoteId)
    } else {
      // 清除报价数据
      setSelectedQuoteItems([])
    }
  }

  // 清除报价引用
  function clearQuoteRef() {
    setSelectedQuoteId('')
    setSelectedQuoteItems([])
    setIncludeQuoteItems(true)
  }

  // 提交创建合同
  async function handleSubmit() {
    if (!partyBName.trim()) {
      setError('请填写乙方名称')
      return
    }

    setLoading(true)
    setError('')

    try {
      const token = localStorage.getItem('token')
      const body: any = {
        party_a_name: partyAName || undefined,
        party_b_name: partyBName,
        party_b_contact: partyBContact || undefined,
        contract_amount: contractAmount ? parseFloat(contractAmount) : undefined,
        tax_amount: taxAmount ? parseFloat(taxAmount) : undefined,
        payment_terms: paymentTerms || undefined,
        delivery_terms: deliveryTerms || undefined,
        contract_date: contractDate || undefined,
        effective_date: effectiveDate || undefined,
        expiry_date: expiryDate || undefined,
        notes: notes || undefined,
      }

      // 可选引用报价
      if (selectedQuoteId) {
        body.quote_id = selectedQuoteId
        body.include_quote_items = includeQuoteItems
      }

      const res = await fetch('/api/contracts', {
        method: 'POST',
        headers: {
          ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '创建失败')
        return
      }

      // 创建成功，跳转到编辑页
      router.push(`/contracts/${data.data.contract_id}/edit`)

    } catch {
      setError('网络错误，创建失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* 顶部 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-sm text-slate-500 mb-1">
            <Link href="/contracts" className="hover:underline">合同审核</Link>
            <span className="mx-2">/</span>
            <span>新建合同</span>
          </div>
          <h1 className="text-2xl font-bold">新建合同</h1>
        </div>
        <Link href="/contracts">
          <Button variant="outline">返回列表</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：合同基本信息 */}
        <div className="lg:col-span-2 space-y-6">
          {/* 甲乙双方 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">合同主体</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">甲方（我方）</label>
                  <Input
                    placeholder="默认为配置中的公司名称"
                    value={partyAName}
                    onChange={(e) => setPartyAName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">乙方（客户）<span className="text-red-500">*</span></label>
                  <Input
                    placeholder="客户公司名称"
                    value={partyBName}
                    onChange={(e) => setPartyBName(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">乙方联系人</label>
                <Input
                  placeholder="姓名、电话等"
                  value={partyBContact}
                  onChange={(e) => setPartyBContact(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* 报价引用（可选）- 作为合同的一个章节 */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">报价章节（可选）</CardTitle>
              {selectedQuoteId && (
                <Button variant="ghost" size="sm" onClick={clearQuoteRef}>
                  <XIcon className="h-4 w-4 mr-1" />
                  移除引用
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {!selectedQuoteId ? (
                <div>
                  <label className="text-sm font-medium">引用已确认的报价</label>
                  <Select value={selectedQuoteId} onValueChange={handleQuoteSelect}>
                    <SelectTrigger>
                      <SelectValue placeholder={quotesLoading ? '加载中...' : '选择报价（可选）'} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">不引用报价</SelectItem>
                      {quotes.map((q) => (
                        <SelectItem key={q.id} value={q.id}>
                          {q.quote_no} - {q.customer_name} (¥{q.total_amount?.toLocaleString()})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-slate-500 mt-1">
                    引用报价后，合同的"报价章节"将包含该报价的总价和分项明细
                  </p>
                </div>
              ) : (
                <div className="bg-slate-50 p-4 rounded-lg">
                  <div className="flex items-center gap-2 text-sm text-slate-600 mb-2">
                    <LinkIcon className="h-4 w-4" />
                    已引用报价
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <Checkbox
                      id="include-items"
                      checked={includeQuoteItems}
                      onCheckedChange={(v) => setIncludeQuoteItems(v as boolean)}
                    />
                    <label htmlFor="include-items" className="text-sm">
                      包含报价分项明细 ({selectedQuoteItems.length} 项)
                    </label>
                  </div>
                  {includeQuoteItems && selectedQuoteItems.length > 0 && (
                    <div className="border rounded overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-100">
                          <tr>
                            <th className="px-3 py-2 text-left">标的名称</th>
                            <th className="px-3 py-2 text-right">数量</th>
                            <th className="px-3 py-2 text-right">单价</th>
                            <th className="px-3 py-2 text-right">小计</th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedQuoteItems.map((item, idx) => (
                            <tr key={idx} className="border-t">
                              <td className="px-3 py-2">{item.name}</td>
                              <td className="px-3 py-2 text-right">{item.quantity}</td>
                              <td className="px-3 py-2 text-right">¥{item.unit_price?.toLocaleString()}</td>
                              <td className="px-3 py-2 text-right">¥{item.line_total?.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* 金额与条款 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">金额与条款</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">合同总金额（元）</label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={contractAmount}
                    onChange={(e) => setContractAmount(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">税额（元）</label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={taxAmount}
                    onChange={(e) => setTaxAmount(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <label className="text-sm font-medium">付款条款</label>
                <Textarea
                  placeholder="例如：合同签订后5个工作日内支付30%预付款..."
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  rows={2}
                />
              </div>
              <div>
                <label className="text-sm font-medium">交付条款</label>
                <Textarea
                  placeholder="例如：合同生效后30个工作日内完成交付..."
                  value={deliveryTerms}
                  onChange={(e) => setDeliveryTerms(e.target.value)}
                  rows={2}
                />
              </div>
            </CardContent>
          </Card>

          {/* 日期 */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">合同日期</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="text-sm font-medium">签约日期</label>
                  <Input
                    type="date"
                    value={contractDate}
                    onChange={(e) => setContractDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">生效日期</label>
                  <Input
                    type="date"
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">到期日期</label>
                  <Input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* 右侧：操作区 */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">创建合同</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
                  {error}
                </div>
              )}

              <Button
                onClick={handleSubmit}
                disabled={loading}
                className="w-full"
                size="lg"
              >
                {loading ? (
                  <>
                    <LoaderIcon className="h-4 w-4 mr-2 animate-spin" />
                    创建中...
                  </>
                ) : (
                  <>
                    <PlusIcon className="h-4 w-4 mr-2" />
                    创建合同草稿
                  </>
                )}
              </Button>

              <div className="text-xs text-slate-500 space-y-1">
                <p>创建后您可以：</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>上传合同文件</li>
                  <li>编辑合同条款</li>
                  <li>提交AI审核</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">提示</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600 space-y-2">
              <p>
                <FileTextIcon className="h-4 w-4 inline mr-1" />
                合同是独立的法律文档，报价只是其中的一个章节。
              </p>
              <p>
                即使引用了报价，您也可以在编辑时修改所有内容。
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
