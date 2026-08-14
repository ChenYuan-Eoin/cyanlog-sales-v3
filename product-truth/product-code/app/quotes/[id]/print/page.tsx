'use client'

// REQ: F029/F030
// PURPOSE: 标准报价单打印页（只读导出数据，内部字段已脱敏；水印+有效期）
import { useEffect, useState, use } from 'react'

interface ExportItem {
  name?: string | null
  version_code?: string | null
  deployment?: string | null
  auth_mode?: string | null
  quantity?: number
  unit_price?: number
  list_price?: number | null
  line_total?: number
  is_gift?: boolean
  tier_range?: string | null
}

interface ExportData {
  quote_no: string
  customer_name: string
  valid_until: string | null
  currency: string
  subtotal: number
  discount_rate: number
  discount_amount: number
  tax_amount: number
  total_amount: number
  total_in_words: string
  tax_summary: unknown
  items: ExportItem[]
  watermark: string
  generated_at: string
}

export default function QuotePrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [data, setData] = useState<ExportData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/quotes/${id}/export`)
      .then((r) => r.json())
      .then((json) => {
        if (!json.success) {
          setError(json.error?.message || '加载失败')
          return
        }
        setData(json.data)
      })
      .catch(() => setError('加载失败'))
  }, [id])

  if (error) {
    return <div className="p-8 text-sm text-destructive">{error}</div>
  }
  if (!data) {
    return <div className="p-8 text-sm text-muted-foreground">加载中…</div>
  }

  const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '-' : n.toLocaleString('zh-CN', { minimumFractionDigits: 2 }))

  return (
    <div className="mx-auto max-w-3xl bg-white p-10 text-slate-900 print:p-0">
      <div className="flex items-start justify-between border-b pb-4">
        <div>
          <h1 className="text-xl font-semibold">深圳复临科技有限公司报价单</h1>
          <div className="mt-1 text-sm text-slate-500">报价单号：{data.quote_no}</div>
        </div>
        <div className="text-right text-sm text-slate-500">
          <div>客户：{data.customer_name}</div>
          <div>有效期至：{data.valid_until ? new Date(data.valid_until).toLocaleDateString('zh-CN') : '-'}</div>
          <div>币种：{data.currency}</div>
        </div>
      </div>

      <table className="mt-6 w-full text-sm">
        <thead>
          <tr className="border-b text-left text-slate-500">
            <th className="py-2">产品</th>
            <th className="py-2">版本/部署/授权</th>
            <th className="py-2 text-right">数量</th>
            <th className="py-2 text-right">单价</th>
            <th className="py-2 text-right">金额</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item, i) => (
            <tr key={i} className="border-b">
              <td className="py-2">{item.name}{item.is_gift ? '（赠送）' : ''}</td>
              <td className="py-2 text-slate-500">
                {[item.version_code, item.deployment, item.auth_mode].filter(Boolean).join(' / ') || '-'}
              </td>
              <td className="py-2 text-right">{item.quantity}</td>
              <td className="py-2 text-right">{fmt(item.unit_price)}</td>
              <td className="py-2 text-right">{item.is_gift ? `原价 ${fmt(item.list_price)} 赠送` : fmt(item.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-6 flex justify-end">
        <div className="w-72 space-y-1 text-sm">
          <div className="flex justify-between"><span className="text-slate-500">小计</span><span>{fmt(data.subtotal)}</span></div>
          {data.discount_amount > 0 && (
            <div className="flex justify-between"><span className="text-slate-500">折扣（{Math.round(data.discount_rate * 100)}%）</span><span>-{fmt(data.discount_amount)}</span></div>
          )}
          <div className="flex justify-between"><span className="text-slate-500">税额</span><span>{fmt(data.tax_amount)}</span></div>
          <div className="flex justify-between border-t pt-1 text-base font-semibold"><span>合计</span><span>{fmt(data.total_amount)}</span></div>
          <div className="pt-1 text-slate-500">大写：{data.total_in_words}</div>
        </div>
      </div>

      <div className="mt-10 border-t pt-3 text-center text-xs text-slate-400">
        {data.watermark}
      </div>
      <div className="mt-6 text-center print:hidden">
        <button onClick={() => window.print()} className="rounded bg-slate-900 px-4 py-2 text-sm text-white">打印</button>
      </div>
    </div>
  )
}
