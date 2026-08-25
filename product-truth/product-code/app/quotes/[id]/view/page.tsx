'use client'

// REQ: WP10 阶段3（L0 客户体验层）
// PURPOSE: 客户可交互报价视图——冻结版本为源数据，客户可调整数量实时预览
// 原则：只读版本数据；交互预览不落库（正式变更走报价变更流程）；内部字段零暴露
import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

interface ViewItem {
  sort_order: number
  product_code?: string | null
  name?: string | null
  version_code?: string | null
  deployment?: string | null
  auth_mode?: string | null
  term_months?: number | null
  quantity: number
  unit_price?: number | null
  list_price?: number | null
  line_total?: number | null
  tax_rate?: number | null
  tax_amount?: number | null
  is_gift?: boolean | null
  tier_range?: string | null
  maintenance_months?: number | null
}

interface ViewData {
  version_no: number
  frozen_at: string
  header: {
    quote_no: string
    customer_name?: string | null
    currency?: string | null
    subtotal?: number | null
    discount_rate?: number | null
    discount_amount?: number | null
    tax_amount?: number | null
    total_amount?: number | null
    valid_until?: string | null
    amount_in_words?: string | null
    notes?: string | null
  }
  items: ViewItem[]
}

const DEPLOY_LABEL: Record<string, string> = { PUBLIC_CLOUD: '公有云', PRIVATE: '私有部署', HA: '高可用' }
const AUTH_LABEL: Record<string, string> = { SUB_YEAR: '按年订阅', SUB_3YEAR: '三年订阅', ONETIME: '一次性授权' }

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100

export default function QuoteCustomerViewPage() {
  const params = useParams()
  const router = useRouter()
  const quoteId = params.id as string
  const [data, setData] = useState<ViewData | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [quantities, setQuantities] = useState<Record<number, number>>({})

  useEffect(() => {
    async function load() {
      try {
        const token = localStorage.getItem('token')
        const res = await fetch(`/api/quotes/${quoteId}/version/latest`, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        })
        const json = await res.json()
        if (!res.ok || !json.success) {
          setError(json.error?.message || '加载失败')
          return
        }
        setData(json.data)
        const initial: Record<number, number> = {}
        for (const item of json.data.items as ViewItem[]) {
          if (!item.is_gift) initial[item.sort_order] = item.quantity
        }
        setQuantities(initial)
      } catch {
        setError('网络错误')
      } finally {
        setLoading(false)
      }
    }
    void load()
  }, [quoteId])

  // 客户调整数量的实时预览：按行 数量×单价 近似重算（不落库；正式变更走流程）
  const preview = useMemo(() => {
    if (!data) return null
    let subtotal = 0
    let taxAmount = 0
    const lines = data.items.map((item) => {
      const qty = item.is_gift ? item.quantity : (quantities[item.sort_order] ?? item.quantity)
      const unit = Number(item.unit_price ?? 0)
      const lineTotal = round2(qty * unit)
      const tax = item.tax_rate != null ? round2(lineTotal * Number(item.tax_rate)) : 0
      if (!item.is_gift) {
        subtotal += lineTotal
        taxAmount += tax
      }
      return { ...item, qty, lineTotal, tax }
    })
    const discountRate = Number(data.header.discount_rate ?? 0)
    const discountAmount = round2(subtotal * discountRate)
    const grandTotal = round2(subtotal - discountAmount + taxAmount)
    return { lines, subtotal, discountRate, discountAmount, taxAmount, grandTotal }
  }, [data, quantities])

  if (loading) return <div className="p-8">加载中…</div>
  if (error) {
    return (
      <div className="mx-auto max-w-3xl p-8">
        <Card><CardContent className="py-12 text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <Link href={`/quotes/${quoteId}`}><Button variant="outline">返回报价详情</Button></Link>
        </CardContent></Card>
      </div>
    )
  }
  if (!data || !preview) return null

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">{data.header.customer_name || '客户'} · 报价方案</h1>
          <p className="text-sm text-muted-foreground">
            {data.header.quote_no} · V{data.version_no} · 冻结于 {new Date(data.frozen_at).toLocaleString('zh-CN')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => window.print()}>打印 / 另存 PDF</Button>
          <Button variant="outline" onClick={() => router.push(`/quotes/${quoteId}/print`)}>标准单视图</Button>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">方案明细（可调整数量实时预览，仅预览不落库）</CardTitle></CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-slate-500">
                  <th className="text-left py-2 pr-3">产品</th>
                  <th className="text-left py-2 pr-3">版本/部署/授权</th>
                  <th className="text-right py-2 pr-3">数量</th>
                  <th className="text-right py-2 pr-3">单价</th>
                  <th className="text-right py-2 pr-3">小计</th>
                </tr>
              </thead>
              <tbody>
                {preview.lines.map((item) => (
                  <tr key={item.sort_order} className="border-b last:border-b-0">
                    <td className="py-3 pr-3">
                      <div className="font-medium">{item.name || item.product_code}</div>
                      {item.is_gift && <span className="text-xs text-emerald-600">赠送</span>}
                    </td>
                    <td className="py-3 pr-3 text-slate-600">
                      {[
                        item.version_code,
                        item.deployment ? DEPLOY_LABEL[item.deployment] || item.deployment : null,
                        item.auth_mode ? AUTH_LABEL[item.auth_mode] || item.auth_mode : null,
                        item.term_months ? `${item.term_months} 个月` : null,
                        item.tier_range ? `阶梯 ${item.tier_range}` : null,
                      ].filter(Boolean).join(' · ') || '—'}
                    </td>
                    <td className="py-3 pr-3 text-right">
                      {item.is_gift ? (
                        <span>{item.qty}</span>
                      ) : (
                        <input
                          type="number"
                          min={1}
                          value={item.qty}
                          onChange={(e) => {
                            const v = Math.max(1, Number(e.target.value || 1))
                            setQuantities((prev) => ({ ...prev, [item.sort_order]: v }))
                          }}
                          className="h-8 w-20 rounded border px-2 text-right"
                        />
                      )}
                    </td>
                    <td className="py-3 pr-3 text-right font-mono">{item.unit_price != null ? item.unit_price.toLocaleString() : '—'}</td>
                    <td className="py-3 pr-3 text-right font-mono">{item.lineTotal.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ml-auto mt-4 w-full max-w-sm space-y-2 rounded-lg border bg-slate-50 p-4 text-sm">
            <div className="flex justify-between text-slate-600"><span>小计</span><span className="font-mono">¥{preview.subtotal.toLocaleString()}</span></div>
            <div className="flex justify-between text-slate-600"><span>折扣 ({Math.round(preview.discountRate * 100)}%)</span><span className="font-mono">-¥{preview.discountAmount.toLocaleString()}</span></div>
            <div className="flex justify-between text-slate-600"><span>税额</span><span className="font-mono">¥{preview.taxAmount.toLocaleString()}</span></div>
            <div className="flex justify-between font-semibold text-slate-900"><span>预计总价</span><span className="font-mono">¥{preview.grandTotal.toLocaleString()}</span></div>
            <p className="text-xs text-slate-500">调整数量仅为方案预览，正式变更需在系统内发起报价变更并重新审批。</p>
          </div>
        </CardContent>
      </Card>

      {data.header.notes && (
        <div className="rounded border bg-slate-50 px-4 py-3 text-sm text-slate-700">{data.header.notes}</div>
      )}
    </div>
  )
}
