'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import {
  calculateQuoteTotals,
  formatTierRangeLabel,
  resolveProductUnitPrice,
  type PriceBookProduct,
  type ProductPriceTier,
} from '@/lib/pricing/engine'
import { deleteBrowserCache, scopedCacheKey } from '@/lib/browser-cache'

interface ProductOption extends PriceBookProduct {
  status: 'active' | 'inactive' | 'discontinued'
  product_price_tiers?: ProductPriceTier[]
}

interface QuoteLineState {
  product_id: string
  quantity: number
}

interface TaxConfig {
  value?: {
    rate?: number
    enabled?: boolean
  }
}

function unwrapList<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) {
    return payload as T[]
  }

  if (payload && typeof payload === 'object') {
    const data = (payload as { data?: unknown }).data
    return Array.isArray(data) ? data as T[] : []
  }

  return []
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

function defaultValidUntil(): string {
  const date = new Date()
  date.setDate(date.getDate() + 30)
  return date.toISOString().slice(0, 10)
}

export default function NewQuotePage() {
  const router = useRouter()
  const [customerName, setCustomerName] = useState('')
  const [customerContact, setCustomerContact] = useState('')
  const [validUntil, setValidUntil] = useState(defaultValidUntil())
  const [notes, setNotes] = useState('')
  const [discountRate, setDiscountRate] = useState(0)
  const [products, setProducts] = useState<ProductOption[]>([])
  const [lines, setLines] = useState<QuoteLineState[]>([{ product_id: '', quantity: 1 }])
  const [taxRate, setTaxRate] = useState(0)
  const [loading, setLoading] = useState(false)
  const [booting, setBooting] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function bootstrap() {
      setBooting(true)
      setError('')
      try {
        const token = localStorage.getItem('token')
        const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}
        const [productsRes, taxRes] = await Promise.all([
          fetch('/api/products?status=active', { headers }),
          fetch('/api/configs?type=TAX_RULE&status=PUBLISHED', { headers }),
        ])

        if (!productsRes.ok) {
          throw new Error('加载 SKU 失败')
        }

        const productData = await productsRes.json()
        setProducts(unwrapList<ProductOption>(productData))

        if (taxRes.ok) {
          const configData = unwrapList<TaxConfig>(await taxRes.json())
          const enabledConfig = configData.find((config) => config.value?.enabled)
          setTaxRate(enabledConfig?.value?.rate ?? 0)
        }
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : '初始化失败')
      } finally {
        setBooting(false)
      }
    }

    bootstrap()
  }, [])

  const linePreviews = useMemo(() => (
    lines.map((line, index) => {
      const product = products.find((item) => item.id === line.product_id)
      if (!product) {
        return {
          index,
          product: null,
          quantity: line.quantity,
          unitPrice: 0,
          lineTotal: 0,
          tierRange: null as string | null,
        }
      }

      const pricing = resolveProductUnitPrice(product, line.quantity)
      return {
        index,
        product,
        quantity: line.quantity,
        unitPrice: pricing.unitPrice,
        lineTotal: pricing.unitPrice * line.quantity,
        tierRange: formatTierRangeLabel(pricing.tier),
      }
    })
  ), [lines, products])

  const totals = useMemo(() => {
    const subtotal = linePreviews.reduce((sum, line) => sum + line.lineTotal, 0)
    return calculateQuoteTotals({
      subtotal,
      discountRate,
      taxRate,
    })
  }, [discountRate, linePreviews, taxRate])

  function updateLine(index: number, next: Partial<QuoteLineState>) {
    setLines((current) => current.map((line, lineIndex) => (
      lineIndex === index ? { ...line, ...next } : line
    )))
  }

  function addLine() {
    setLines((current) => [...current, { product_id: '', quantity: 1 }])
  }

  function removeLine(index: number) {
    setLines((current) => current.length === 1
      ? [{ product_id: '', quantity: 1 }]
      : current.filter((_, lineIndex) => lineIndex !== index))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const effectiveItems = lines
      .filter((line) => line.product_id)
      .map((line, index) => ({
        product_type: 'sku' as const,
        product_id: line.product_id,
        quantity: line.quantity,
        sort_order: index,
      }))

    if (effectiveItems.length === 0) {
      setError('请至少选择一个 SKU')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token') || ''}`,
        },
        body: JSON.stringify({
          customer_name: customerName,
          customer_contact: customerContact,
          valid_until: validUntil || undefined,
          notes: notes || undefined,
          discount_rate: discountRate,
          items: effectiveItems,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(readApiError(data, '创建失败'))
        setLoading(false)
        return
      }

      const quoteId = data?.data?.id || data?.id
      if (!quoteId) {
        setError('创建成功但未返回报价ID')
        setLoading(false)
        return
      }

      const token = localStorage.getItem('token')
      deleteBrowserCache(scopedCacheKey(token, 'quotes:list'))
      router.push(`/quotes/${quoteId}`)
      router.refresh()
    } catch {
      setError('网络错误，请稍后重试')
      setLoading(false)
    }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">新建报价</h1>
        <p className="text-sm text-slate-500 mt-1">选择配置中心已发布 SKU，系统会按数量自动命中基础价或阶梯价。</p>
      </div>

      <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>基础信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</div>
              )}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">客户名称 *</label>
                  <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">客户联系方式</label>
                  <Input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium">有效期至</label>
                  <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">整单折扣 (%)</label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={discountRate}
                    onChange={(e) => setDiscountRate(Number(e.target.value || 0))}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">备注</label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="补充交付说明、商务备注等" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>报价明细</CardTitle>
              <Button type="button" variant="outline" onClick={addLine}>+ 增加 SKU</Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {booting ? (
                <div className="text-sm text-slate-500">加载价盘中...</div>
              ) : (
                lines.map((line, index) => {
                  const preview = linePreviews[index]
                  return (
                    <div key={index} className="rounded-lg border p-4">
                      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_120px_88px]">
                        <div>
                          <label className="mb-1 block text-sm font-medium">SKU</label>
                          <select
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            value={line.product_id}
                            onChange={(e) => updateLine(index, { product_id: e.target.value })}
                          >
                            <option value="">选择 SKU</option>
                            {products.map((product) => (
                              <option key={product.id} value={product.id}>
                                {product.code} · {product.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium">数量</label>
                          <Input
                            type="number"
                            min={1}
                            value={line.quantity}
                            onChange={(e) => updateLine(index, { quantity: Math.max(1, Number(e.target.value || 1)) })}
                          />
                        </div>
                        <div className="flex items-end">
                          <Button type="button" variant="outline" className="w-full" onClick={() => removeLine(index)}>
                            删除
                          </Button>
                        </div>
                      </div>

                      {preview?.product && (
                        <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-600">
                          <div className="font-medium text-slate-900">{preview.product.name}</div>
                          <div className="mt-1 flex flex-wrap gap-3 text-xs">
                            <span>{preview.product.specification || '无规格'}</span>
                            <span>{preview.product.unit || '无单位'}</span>
                            <span>单价 ¥{preview.unitPrice.toLocaleString()}</span>
                            <span>小计 ¥{preview.lineTotal.toLocaleString()}</span>
                            <span>{preview.tierRange ? `命中阶梯 ${preview.tierRange}` : '基础价'}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>汇总</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <SummaryRow label="小计" value={`¥${totals.subtotal.toLocaleString()}`} />
            <SummaryRow label={`折扣 (${discountRate.toFixed(2)}%)`} value={`-¥${totals.discountAmount.toLocaleString()}`} />
            <SummaryRow label={`税额 (${(taxRate * 100).toFixed(0)}%)`} value={`¥${totals.taxAmount.toLocaleString()}`} />
            <SummaryRow label="总计" value={`¥${totals.totalAmount.toLocaleString()}`} strong />
            <div className="pt-4">
              <Button type="submit" className="w-full" disabled={loading || booting}>
                {loading ? '保存中...' : '创建报价'}
              </Button>
              <Button type="button" variant="outline" className="mt-2 w-full" onClick={() => router.push('/quotes')}>
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${strong ? 'font-semibold text-slate-900' : 'text-slate-600'}`}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  )
}
