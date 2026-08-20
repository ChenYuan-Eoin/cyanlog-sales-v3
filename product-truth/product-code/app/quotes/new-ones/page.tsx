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
  term_options?: number[]
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
  discount_rate: number
}

const DEPLOY_LABEL: Record<string, string> = { PUBLIC_CLOUD: '公有云', PRIVATE: '私有部署', HA: '高可用' }
const AUTH_LABEL: Record<string, string> = { SUB_YEAR: '按年订阅', SUB_3YEAR: '三年订阅', ONETIME: '一次性授权' }

function emptyLine(defaultQty: number | null): LineState {
  return { product_id: '', version_code: '', deployment: '', auth_mode: '', term_months: '12', quantity: defaultQty ?? 0, is_gift: false, discount_rate: 0 }
}

export default function NewOnesQuotePage() {
  const [products, setProducts] = useState<ProductOption[]>([])
  const [versions, setVersions] = useState<ProductVersion[]>([])
  const [matrix, setMatrix] = useState<PriceMatrixRow[]>([])
  const [lines, setLines] = useState<LineState[]>([emptyLine(null)])
  const [discountRate, setDiscountRate] = useState(0)
  const [discountReason, setDiscountReason] = useState('')
  const [region, setRegion] = useState('CN')
  const [regions, setRegions] = useState<Array<{ region: string; softwareRate: number; serviceRate: number; currency: string }>>([])
  const [softwareTaxRate, setSoftwareTaxRate] = useState(0.13)
  const [discountTiers, setDiscountTiers] = useState<number[]>([0, 5, 10, 15, 20, 25, 30, 40])
  const [discountMax, setDiscountMax] = useState(40)
  const [defaultQty, setDefaultQty] = useState<number | null>(null)
  const [serviceTaxRate, setServiceTaxRate] = useState(0.06)
  const [customerName, setCustomerName] = useState('')
  const [customerContact, setCustomerContact] = useState('')
  const [opportunities, setOpportunities] = useState<Array<{ id: string; name: string; customer_name?: string | null; customer_region?: string | null; amount?: number | null }>>([])
  const [opportunityId, setOpportunityId] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [step, setStep] = useState(1)

  useEffect(() => {
    async function bootstrap() {
      try {
        const [productsRes, versionsRes, matrixRes, regionRes, oppRes] = await Promise.all([
          fetch('/api/products?status=active'),
          fetch('/api/config-center/product-versions?status=PUBLISHED&limit=100'),
          fetch('/api/config-center/price-matrix?status=PUBLISHED&limit=5000'),
          fetch('/api/config-center/regional-tax-rates?status=PUBLISHED&limit=100'),
          fetch('/api/opportunities'),
        ])
        const [pj, vj, mj, rj, oj] = await Promise.all([productsRes.json(), versionsRes.json(), matrixRes.json(), regionRes.json(), oppRes.json()])
        const businessRes = await fetch('/api/config-center/business-params?status=PUBLISHED&limit=100')
        const bj = await businessRes.json()
        const regionRows = (rj.data || []) as Array<{ region: string; software_rate?: number; service_rate?: number; currency?: string }>
        if (regionRows.length > 0) {
          const list = regionRows.map((r) => ({ region: r.region, softwareRate: Number(r.software_rate ?? 0.13), serviceRate: Number(r.service_rate ?? 0.06), currency: r.currency || 'CNY' }))
          setRegions(list)
          const cur = list.find((r) => r.region === 'CN') || list[0]
          setRegion(cur.region)
          setSoftwareTaxRate(cur.softwareRate)
          setServiceTaxRate(cur.serviceRate)
        }
        const paramRows = (bj.data || []) as Array<{ param_key: string; value?: unknown }>
        const tiersRow = paramRows.find((x) => x.param_key === 'DISCOUNT_TIERS')
        const maxRow = paramRows.find((x) => x.param_key === 'DISCOUNT_MAX')
        const qtyRow = paramRows.find((x) => x.param_key === 'DEFAULT_QTY')
        const validRow = paramRows.find((x) => x.param_key === 'QUOTE_VALID_DAYS')
        if (qtyRow) {
          const qv = qtyRow.value
          const qn = typeof qv === 'number' ? qv : typeof qv === 'string' ? Number(qv) : NaN
          if (!Number.isNaN(qn) && qn > 0) setDefaultQty(qn)
        }
        void validRow
        if (tiersRow && Array.isArray(tiersRow.value)) {
          setDiscountTiers((tiersRow.value as unknown[]).filter((v): v is number => typeof v === 'number'))
        }
        if (maxRow) {
          const mv = maxRow.value
          const num = typeof mv === 'number' ? mv : typeof mv === 'string' ? Number(mv) : NaN
          if (!Number.isNaN(num)) setDiscountMax(num)
        }
        setProducts((pj.data || []).map((p: Record<string, unknown>) => ({ id: String(p.id), code: String(p.code), name: String(p.name), attributes: (p.attributes ?? null) as ProductOption['attributes'] })))
        setVersions((vj.data || []).map((v: Record<string, unknown>) => ({ version_code: String(v.version_code), name: String(v.name), deployments: (v.deployments || []) as string[], auth_modes: (v.auth_modes || []) as string[], term_options: (v.term_options || [12]) as number[], capabilities: (v.capabilities || {}) as Record<string, boolean> })))
        setMatrix((mj.data || []) as PriceMatrixRow[])
        setOpportunities((oj.data || []) as typeof opportunities)
        // 有效期默认值：仅当业务参数 QUOTE_VALID_DAYS 已配置时预填；无配置留空由用户填写
        const vdNum = (() => {
          if (!validRow) return null
          const vv = validRow.value
          const n = typeof vv === 'number' ? vv : typeof vv === 'string' ? Number(vv) : NaN
          return !Number.isNaN(n) && n > 0 ? n : null
        })()
        if (vdNum != null) {
          const d = new Date()
          d.setDate(d.getDate() + vdNum)
          setValidUntil(d.toISOString().slice(0, 10))
        }
      } catch (e) {
        setError('加载配置失败：' + (e instanceof Error ? e.message : String(e)))
      } finally {
        setLoading(false)
      }
    }
    void bootstrap()
  }, [])

  function applyOpportunity(id: string) {
    setOpportunityId(id)
    const opp = opportunities.find((o) => o.id === id)
    if (!opp) return
    if (opp.customer_name) setCustomerName(opp.customer_name)
    if (opp.customer_region) {
      const regionCode = String(opp.customer_region).toUpperCase().slice(0, 10)
      setRegion(regionCode)
      const cfg = regions.find((x) => x.region === regionCode)
      if (cfg) { setSoftwareTaxRate(cfg.softwareRate); setServiceTaxRate(cfg.serviceRate) }
    }
  }

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
        discountRate: line.discount_rate || undefined,
        tiers,
      }
    })
    return calculateQuote({ lines: inputs, discountRate, softwareTaxRate, serviceTaxRate, currency: 'CNY' })
  }, [lines, products, matrix, discountRate, softwareTaxRate, serviceTaxRate])

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
          discount_rate: src.discount_rate || undefined,
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
          opportunity_id: opportunityId || undefined,
          valid_until: validUntil,
          notes: '',
          discount_rate: discountRate,
          discount_reason: discountRate > 0 ? discountReason : undefined,
          quote_kind: 'STANDARD',
          region,
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

  const canGoNextFrom1 = lines.length > 0 && lines.every((l) => l.product_id && l.version_code && l.deployment && l.auth_mode)
  const canGoNextFrom2 = lines.every((l) => l.quantity > 0) && (discountRate === 0 || (discountReason || '').trim().length > 0)
  const stepError = step === 1 && !canGoNextFrom1 ? '请先为每一行选择 产品/版本/部署/授权/期限' : step === 2 && !canGoNextFrom2 ? (discountRate > 0 && !(discountReason || '').trim() ? '有折扣必须填写折扣原因（为什么这样报价）' : '请填写有效数量') : ''

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-xl font-semibold">ONES 结构化报价</h1>
        <p className="text-sm text-muted-foreground">引导式报价：选产品/版本 → 部署/授权/期限 → 数量/折扣 → 自动审核核验</p>
      </div>
      {error && <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}

      {/* 步骤条 */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { n: 1, label: '选品与配置' },
          { n: 2, label: '数量与折扣' },
          { n: 3, label: '确认提交' },
        ].map((s, i) => (
          <div key={s.n} className="flex items-center gap-2">
            {i > 0 && <span className="text-slate-300">→</span>}
            <button
              type="button"
              onClick={() => setStep(s.n)}
              className={`rounded-full px-3 py-1 ${step === s.n ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}
            >
              {s.n}. {s.label}
            </button>
          </div>
        ))}
      </div>

      {stepError && <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-700">{stepError}</div>}

      {/* Step 1: 客户与选品/版本/部署/授权/期限 */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="grid gap-3 rounded border p-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="text-sm text-muted-foreground">关联商机（可选，自动带出客户/区域）</label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={opportunityId} onChange={(e) => applyOpportunity(e.target.value)}>
                <option value="">不关联商机（手工填写）</option>
                {opportunities.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}{o.customer_name ? ` · ${o.customer_name}` : ''}</option>
                ))}
              </select>
            </div>
            <div><label className="text-sm text-muted-foreground">客户名称</label><Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} /></div>
            <div><label className="text-sm text-muted-foreground">联系人</label><Input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} /></div>
            <div><label className="text-sm text-muted-foreground">有效期至</label><Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></div>
            <div>
              <label className="text-sm text-muted-foreground">销售区域</label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={region} onChange={(e) => {
                const r = e.target.value
                setRegion(r)
                const cfg = regions.find((x) => x.region === r)
                if (cfg) { setSoftwareTaxRate(cfg.softwareRate); setServiceTaxRate(cfg.serviceRate) }
              }}>
                {(regions.length > 0 ? regions : [{ region: 'CN', softwareRate: 0.13, serviceRate: 0.06, currency: 'CNY' }]).map((r) => (
                  <option key={r.region} value={r.region}>{r.region}（软件税 {(r.softwareRate * 100).toFixed(0)}% / 服务税 {(r.serviceRate * 100).toFixed(0)}%）</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">产品配置（每行：产品 → 版本 → 部署 → 授权 → 期限）</p>
            {lines.map((line, index) => {
              const product = products.find((p) => p.id === line.product_id)
              const version = versions.find((v) => v.version_code === line.version_code)
              return (
                <div key={index} className="grid gap-2 rounded border p-3 sm:grid-cols-5">
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
                  <select className="h-9 rounded-md border bg-background px-2 text-sm" value={line.term_months} onChange={(e) => updateLine(index, { term_months: e.target.value })}>
                    <option value="">期限</option>
                    {(version?.term_options || [12]).map((t) => <option key={t} value={t}>{t} 个月</option>)}
                  </select>
                  {lines.length > 1 && <button className="text-xs text-destructive" onClick={() => setLines(lines.filter((_, i) => i !== index))}>删除</button>}
                </div>
              )
            })}
            <Button variant="outline" size="sm" onClick={() => setLines([...lines, emptyLine(defaultQty)])}>+ 添加产品</Button>
          </div>
        </div>
      )}

      {/* Step 2: 数量/行折扣/赠送 + 整单折扣/原因 */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="space-y-3">
            {lines.map((line, index) => (
              <div key={index} className="grid items-center gap-2 rounded border p-3 sm:grid-cols-4">
                <span className="text-sm text-slate-600">{products.find((p) => p.id === line.product_id)?.name || '产品'} · {line.version_code || ''}</span>
                <div><label className="text-xs text-muted-foreground">数量</label><Input type="number" min={1} value={line.quantity} onChange={(e) => updateLine(index, { quantity: Math.max(1, Number(e.target.value || 1)) })} /></div>
                <div>
                  <label className="text-xs text-muted-foreground">行折扣</label>
                  <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={Math.round(line.discount_rate * 100)} onChange={(e) => updateLine(index, { discount_rate: Number(e.target.value || 0) / 100 })}>
                    {discountTiers.map((t) => <option key={t} value={t}>{t === 0 ? '0%' : `${t}%${t > discountMax ? '（需审批）' : ''}`}</option>)}
                  </select>
                </div>
                <label className="flex items-center gap-1 text-sm">
                  <input type="checkbox" checked={line.is_gift} onChange={(e) => updateLine(index, { is_gift: e.target.checked })} /> 赠送
                </label>
              </div>
            ))}
          </div>

          <div className="grid gap-3 rounded border p-4 sm:grid-cols-2">
            <div>
              <label className="text-sm text-muted-foreground">整单折扣档位</label>
              <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={Math.round(discountRate * 100)} onChange={(e) => setDiscountRate(Number(e.target.value || 0) / 100)}>
                {discountTiers.map((t) => (
                  <option key={t} value={t}>{t}%{t > discountMax ? '（需审批）' : t === discountMax ? '（上限）' : ''}</option>
                ))}
              </select>
              {discountRate * 100 > discountMax && (
                <p className="mt-1 text-xs text-amber-600">超过常规折扣上限 {discountMax}%，提交后需审批确认</p>
              )}
            </div>
            {discountRate > 0 && (
              <div><label className="text-sm text-muted-foreground">折扣原因（为什么这样报价，必填）</label><Input value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} placeholder="如：老客户年度续约优惠、竞争性项目" /></div>
            )}
          </div>
        </div>
      )}

      {/* Step 3: 确认与提交 */}
      {step === 3 && (
        <div className="space-y-4">
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
                <div>税额：¥{result.taxAmount.toLocaleString()}</div>
                <div className="font-semibold">合计：¥{result.grandTotal.toLocaleString()}</div>
                <div className="sm:col-span-2 text-muted-foreground">大写：{result.totalInWords}</div>
              </div>
              <p className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
                保存后系统将自动执行审核核验（抬头/版本可售/计算一致/折扣原因/毛利底线/区域一致等），不满足要求将暂缓审批。
              </p>
            </div>
          )}
        </div>
      )}

      {/* 导航 */}
      <div className="flex items-center justify-between border-t pt-4">
        <Button variant="outline" onClick={() => setStep((s) => Math.max(1, s - 1))} disabled={step === 1}>上一步</Button>
        {step < 3 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={(step === 1 && !canGoNextFrom1) || (step === 2 && !canGoNextFrom2)}>下一步</Button>
        ) : (
          <Button onClick={submit} disabled={submitting || !result.ok || loading}>{submitting ? '提交中…' : '保存报价草稿'}</Button>
        )}
      </div>
    </div>
  )
}
