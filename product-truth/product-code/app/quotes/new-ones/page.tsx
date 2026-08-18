'use client'

// REQ: F037/F038/F044/F045
// PURPOSE: ONES 结构化报价编辑器（选品→版本/部署/授权/期限→组合校验→实时算价→提交）
// 与现有 /quotes/new 并行；服务端未迁移时提交走 legacy 回退
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { calculateQuote } from '@/lib/pricing/quote-calculator'
import type { QuoteLineInput } from '@/lib/pricing/quote-builder'
import type { CumulativeTier } from '@/lib/pricing/cumulative'

interface ProductOption {
  id: string
  code: string
  name: string
  attributes?: {
    category?: 'BASE' | 'FOLLOW_PRODUCT' | 'FOLLOW_APP' | 'FOLLOW_ECO'
    follows?: string[]
    version_codes?: string[]
    standalone?: boolean
  } | null
}

interface ProductVersion {
  version_code: string
  name: string
  deployments: string[]
  auth_modes: string[]
  capabilities: Record<string, boolean>
}

interface PriceMatrixRow {
  product_id: string
  version_code: string
  deployment: string
  auth_mode: string
  term_months: number | null
  qty_from: number
  qty_to: number | null
  unit_price: number | null
  list_price: number | null
}

interface LineState {
  product_id: string
  version_code: string
  deployment: string
  auth_mode: string
  term_months: string
  quantity: number
  is_gift: boolean
}

const DEPLOY_LABEL: Record<string, string> = { PUBLIC_CLOUD: '公有云', PRIVATE: '私有部署', HA: '高可用' }
const AUTH_LABEL: Record<string, string> = { SUB_YEAR: '按年订阅', SUB_3YEAR: '三年订阅', ONETIME: '一次性授权' }

function emptyLine(): LineState {
  return { product_id: '', version_code: '', deployment: '', auth_mode: '', term_months: '12', quantity: 10, is_gift: false }
}

export default function NewOnesQuotePage() {
  const [products, setProducts] = useState<ProductOption[]>([])
  const [versions, setVersions] = useState<ProductVersion[]>([])
  const [matrix, setMatrix] = useState<PriceMatrixRow[]>([])
  const [lines, setLines] = useState<LineState[]>([emptyLine()])
  const [discountRate, setDiscountRate] = useState(0)
  const [discountReason, setDiscountReason] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [customerContact, setCustomerContact] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    async function bootstrap() {
      try {
        const [productsRes, versionsRes, matrixRes] = await Promise.all([
          fetch('/api/products?status=active'),
          fetch('/api/config-center/product-versions?status=PUBLISHED&limit=100'),
          fetch('/api/config-center/price-matrix?status=PUBLISHED&limit=5000'),
        ])
        const [pj, vj, mj] = await Promise.all([productsRes.json(), versionsRes.json(), matrixRes.json()])
        setProducts((pj.data || []).map((p: Record<string, unknown>) => ({ id: String(p.id), code: String(p.code), name: String(p.name), attributes: (p.attributes ?? null) as ProductOption['attributes'] })))
        setVersions((vj.data || []).map((v: Record<string, unknown>) => ({ version_code: String(v.version_code), name: String(v.name), deployments: (v.deployments || []) as string[], auth_modes: (v.auth_modes || []) as string[], capabilities: (v.capabilities || {}) as Record<string, boolean> })))
        setMatrix((mj.data || []) as PriceMatrixRow[])
        setValidUntil(() => {
          const d = new Date()
          d.setDate(d.getDate() + 15)
          return d.toISOString().slice(0, 10)
        })
      } catch (e) {
        setError('加载配置失败：' + (e instanceof Error ? e.message : String(e)))
      } finally {
        setLoading(false)
      }
    }
    void bootstrap()
  }, [])

  function updateLine(index: number, next: Partial<LineState>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...next } : line)))
  }

  const result = useMemo(() => {
    const inputs: QuoteLineInput[] = lines.map((line) => {
      const product = products.find((p) => p.id === line.product_id)
      const tiers: CumulativeTier[] = matrix
        .filter(
          (r) =>
            r.product_id === line.product_id &&
            r.version_code === line.version_code &&
            r.deployment === line.deployment &&
            r.auth_mode === line.auth_mode &&
            (line.term_months === '' ? r.term_months == null : String(r.term_months) === line.term_months)
        )
        .map((r) => ({ qty_from: r.qty_from, qty_to: r.qty_to, unit_price: r.unit_price, list_price: r.list_price }))
      return {
        productId: line.product_id,
        productCode: product?.code ?? '',
        category: product?.attributes?.category ?? 'BASE',
        follows: product?.attributes?.follows ?? [],
        versionCode: line.version_code,
        deployment: line.deployment,
        authMode: line.auth_mode,
        termMonths: line.term_months === '' ? null : Number(line.term_months),
        quantity: line.quantity,
        isGift: line.is_gift,
        tiers,
      }
    })
    return calculateQuote({ lines: inputs, discountRate, softwareTaxRate: 0.13, serviceTaxRate: 0.06, currency: 'CNY' })
  }, [lines, products, matrix, discountRate])

  async function submit() {
    if (!customerName.trim()) {
      setError('请填写客户名称')
      return
    }
    if (!result.ok) {
      setError(result.issues.map((i) => i.message).join('；') || (result.noPrice ? '存在 10,000+ 无价档，需人工评审' : ''))
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const items = result.lines.map((line, index) => {
        const src = lines[index]
        return {
          product_type: 'sku',
          product_id: src.product_id,
          quantity: line.quantity,
          unit_price: line.unitPrice ?? undefined,
          discount: 0,
          sort_order: index,
          version_code: src.version_code || undefined,
          deployment: src.deployment || undefined,
          auth_mode: src.auth_mode || undefined,
          term_months: src.term_months === '' ? null : Number(src.term_months),
          list_price: line.listPrice ?? undefined,
          is_gift: line.isGift,
          gift_original_amount: line.giftOriginalAmount ?? undefined,
        }
      })
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_name: customerName,
          customer_contact: customerContact,
          valid_until: validUntil,
          notes: '',
          discount_rate: discountRate,
          discount_reason: discountRate > 0 ? discountReason : undefined,
          quote_kind: 'STANDARD',
          items,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setError(json.error?.message || '提交失败')
        return
      }
      window.location.href = `/quotes/${json.data.id}`
    } catch (e) {
      setError('提交失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">ONES 结构化报价</h1>
        <p className="text-sm text-muted-foreground">版本/部署/授权/期限联动 + 搭售校验 + 累计阶梯计价（与现有报价页并行，服务端未迁移时自动回退）</p>
      </div>
      {error && <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      <div className="grid gap-3 rounded border p-4 sm:grid-cols-2">
        <div><label className="text-sm text-muted-foreground">客户名称</label><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></div>
        <div><label className="text-sm text-muted-foreground">联系人</label><Input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} /></div>
        <div><label className="text-sm text-muted-foreground">有效期至</label><Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
        <div><label className="text-sm text-muted-foreground">整单折扣（%）</label><Input type="number" min={0} max={100} value={discountRate * 100} onChange={(e) => setDiscountRate(Number(e.target.value || 0) / 100)} /></div>
        {discountRate > 0 && (
          <div className="sm:col-span-2"><label className="text-sm text-muted-foreground">折扣原因（为什么这样报价，必填）</label><Input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="如：老客户年度续约优惠、竞争性项目" /></div>
        )}
      </div>

      <div className="space-y-3">
        {lines.map((line, index) => {
          const product = products.find((p) => p.id === line.product_id)
          const version = versions.find((v) => v.version_code === line.version_code)
          return (
            <div key={index} className="grid gap-2 rounded border p-3 sm:grid-cols-6">
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={line.product_id} onChange={(e) => updateLine(index, { product_id: e.target.value, version_code: '', deployment: '', auth_mode: '' })}>
                <option value="">选择产品</option>
                {products.map((p) => <option key={p.id} value={p.id}>{p.name}（{p.code}）</option>)}
              </select>
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={line.version_code} onChange={(e) => updateLine(index, { version_code: e.target.value, deployment: '', auth_mode: '' })}>
                <option value="">版本</option>
                {versions.filter((v) => !product?.attributes?.version_codes || product.attributes.version_codes.includes(v.version_code)).map((v) => <option key={v.version_code} value={v.version_code}>{v.name}</option>)}
              </select>
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={line.deployment} onChange={(e) => updateLine(index, { deployment: e.target.value, auth_mode: '' })}>
                <option value="">部署</option>
                {(version?.deployments || []).map((d) => <option key={d} value={d}>{DEPLOY_LABEL[d] || d}</option>)}
              </select>
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={line.auth_mode} onChange={(e) => updateLine(index, { auth_mode: e.target.value })}>
                <option value="">授权</option>
                {(version?.auth_modes || []).map((a) => <option key={a} value={a}>{AUTH_LABEL[a] || a}</option>)}
              </select>
              <Input type="number" min={1} value={line.quantity} onChange={(e) => updateLine(index, { quantity: Math.max(1, Number(e.target.value || 1)) })} />
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={line.is_gift} onChange={(e) => updateLine(index, { is_gift: e.target.checked })} /> 赠送
              </label>
              {lines.length > 1 && <button className="text-xs text-destructive" onClick={() => setLines(lines.filter((_, i) => i !== index))}>删除</button>}
            </div>
          )
        })}
        <Button variant="outline" size="sm" onClick={() => setLines([...lines, emptyLine()])}>+ 添加产品</Button>
      </div>

      {loading ? <div className="text-sm text-muted-foreground">加载配置…</div> : (
        <div className="rounded border p-4">
          {!result.ok && result.issues.length > 0 && (
            <ul className="mb-3 space-y-1 text-sm text-destructive">
              {result.issues.map((issue, i) => <li key={i}>· {issue.message}</li>)}
            </ul>
          )}
          {result.noPrice && <div className="mb-3 text-sm text-amber-600">存在 10,000+ 无价档：需人工评审，不自动出价。</div>}
          <div className="grid gap-1 text-sm sm:grid-cols-2">
            <div>小计：¥{result.subtotal.toLocaleString()}</div>
            <div>折扣：-¥{result.discountAmount.toLocaleString()}</div>
            <div>税额（软件13%+服务6%）：¥{result.taxAmount.toLocaleString()}</div>
            <div className="font-semibold">合计：¥{result.grandTotal.toLocaleString()}</div>
            <div className="sm:col-span-2 text-muted-foreground">大写：{result.totalInWords}</div>
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={submitting || !result.ok || loading}>{submitting ? '提交中…' : '保存报价草稿'}</Button>
      </div>
    </div>
  )
}
