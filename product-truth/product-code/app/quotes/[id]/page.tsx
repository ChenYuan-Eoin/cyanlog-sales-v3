'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import type { Quote, QuoteItem } from '@/types'
import { deleteBrowserCache, readBrowserCacheEntry, scopedCacheKey, writeBrowserCache } from '@/lib/browser-cache'
import {
  QUOTE_DETAIL_BACKGROUND_REFRESH_MS,
  QUOTE_DETAIL_VISIBLE_CACHE_TTL_MS,
  quoteDetailCacheKey,
} from '@/lib/core-page-warmup'
import ReviewPanel from './ReviewPanel'

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  DRAFT: { label: '草稿', variant: 'secondary' },
  PENDING_APPROVAL: { label: '审批中', variant: 'default' },
  APPROVED: { label: '已批准', variant: 'outline' },
  REJECTED: { label: '已驳回', variant: 'destructive' },
}

const pricingSourceMap: Record<string, string> = {
  tier: '阶梯价',
  base: '基础价',
  manual: '手工价',
}

export default function QuoteDetailPage() {
  const params = useParams()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState(false)
  const [cloning, setCloning] = useState(false)
  const [cloneError, setCloneError] = useState('')
  const [reviewTick, setReviewTick] = useState(0)

  const quoteId = params.id as string

  useEffect(() => {
    fetchQuote()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId])

  async function fetchQuote({ allowCache = true }: { allowCache?: boolean } = {}) {
    let servedCached = false
    try {
      const token = localStorage.getItem('token')
      const cacheKey = quoteDetailCacheKey(token, quoteId)
      const cachedEntry = allowCache ? readBrowserCacheEntry<Quote>(cacheKey) : null
      const cacheAgeMs = cachedEntry ? Date.now() - cachedEntry.savedAt : Number.POSITIVE_INFINITY
      const cached = cacheAgeMs <= QUOTE_DETAIL_VISIBLE_CACHE_TTL_MS ? cachedEntry?.value : null

      if (cached) {
        servedCached = true
        setQuote(cached)
        setError('')
        setLoading(false)
        if (cacheAgeMs < QUOTE_DETAIL_BACKGROUND_REFRESH_MS) return
      } else {
        setLoading(true)
      }

      const res = await fetch(`/api/quotes/${quoteId}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        if (!servedCached) {
          if (res.status === 404) setError('报价单不存在')
          else if (res.status === 401) setError('未登录或登录已过期')
          else setError('获取报价失败')
        }
        return
      }

      const data = await res.json()
      setQuote(data)
      setError('')
      writeBrowserCache(cacheKey, data)
    } catch {
      if (!servedCached) {
        setError('网络错误，请稍后重试')
      }
    } finally {
      setLoading(false)
    }
  }

  async function cloneQuote() {
    if (!quote) return
    setCloning(true)
    setCloneError('')
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/quotes/${quote.id}/clone`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token || ''}` },
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setCloneError(json.error?.message || '复制失败')
        return
      }
      window.location.href = `/quotes/${json.data.id}`
    } catch {
      setCloneError('复制失败：网络错误')
    } finally {
      setCloning(false)
    }
  }

  async function updateStatus(newStatus: string) {
    if (!quote) return
    setUpdating(true)

    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/quotes/${quoteId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token || ''}`,
        },
        body: JSON.stringify({ status: newStatus }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error?.message || data.error || '操作失败')
        if (data.error?.code === 'REVIEW_BLOCKED') {
          setReviewTick((t) => t + 1)
        }
        setUpdating(false)
        return
      }

      deleteBrowserCache(scopedCacheKey(token, 'quotes:list'))
      deleteBrowserCache(quoteDetailCacheKey(token, quoteId))
      await fetchQuote({ allowCache: false })
    } catch {
      setError('网络错误')
    } finally {
      setUpdating(false)
    }
  }

  if (loading) {
    return <div className="p-8">加载中...</div>
  }

  if (error) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-red-600 mb-4">{error}</p>
            <Link href="/quotes">
              <Button variant="outline">返回列表</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!quote) {
    return (
      <div className="p-8">
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-slate-500 mb-4">报价单不存在</p>
            <Link href="/quotes">
              <Button variant="outline">返回列表</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Determine available actions based on status
  const canSubmit = quote.status === 'DRAFT'
  const canApprove = quote.status === 'PENDING_APPROVAL'
  const canReject = quote.status === 'PENDING_APPROVAL'

  return (
    <div className="p-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="text-sm text-slate-500 mb-1">
            <Link href="/quotes" className="hover:underline">报价中心</Link>
            <span className="mx-2">/</span>
            <span>详情</span>
          </div>
          <h1 className="text-2xl font-bold">{quote.quote_no}</h1>
        </div>
        <Link href="/quotes">
          <Button variant="outline">返回列表</Button>
        </Link>
      </div>

      {/* Basic Info */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">基本信息</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-slate-500">状态：</span>
              <Badge variant={statusMap[quote.status]?.variant || 'default'}>
                {statusMap[quote.status]?.label || quote.status}
              </Badge>
            </div>
            <div>
              <span className="text-slate-500">客户：</span>
              <span>{quote.customer_name}</span>
            </div>
            <div>
              <span className="text-slate-500">总金额：</span>
              <span className="font-medium">¥{(quote.total_amount || 0).toLocaleString()}</span>
            </div>
            <div>
              <span className="text-slate-500">税率：</span>
              <span>{(((quote.tax_rate || 0) as number) * 100).toFixed(0)}%</span>
            </div>
            <div>
              <span className="text-slate-500">折扣：</span>
              <span>{(quote.discount_rate || 0).toFixed(2)}%</span>
            </div>
            <div>
              <span className="text-slate-500">创建时间：</span>
              <span>{new Date(quote.created_at).toLocaleString('zh-CN')}</span>
            </div>
            <div>
              <span className="text-slate-500">有效期：</span>
              <span>{quote.valid_until ? new Date(quote.valid_until).toLocaleDateString('zh-CN') : '—'}</span>
            </div>
            <div>
              <span className="text-slate-500">区域：</span>
              <span>{quote.region || 'CN'}</span>
            </div>
            {quote.opportunity_id && (
              <div>
                <span className="text-slate-500">商机：</span>
                <Link href={`/opportunities/${quote.opportunity_id}`} className="text-blue-600 hover:underline">
                  查看商机
                </Link>
              </div>
            )}
            {quote.source_quote_id && (
              <div>
                <span className="text-slate-500">来源：</span>
                <Link href={`/quotes/${quote.source_quote_id}`} className="text-blue-600 hover:underline">
                  复制自历史报价
                </Link>
              </div>
            )}
          </div>

          {quote.notes && (
            <div className="mt-4 rounded-md border bg-slate-50 px-3 py-2 text-sm text-slate-700">
              {quote.notes}
            </div>
          )}

          {/* Action Buttons */}
          <div className="mt-6 pt-4 border-t flex gap-4">
            <Button onClick={cloneQuote} disabled={cloning || !quote.id} variant="outline">
              {cloning ? '复制中...' : '复制为草稿'}
            </Button>
            {cloneError && <span className="text-sm text-red-600 self-center">{cloneError}</span>}
            {canSubmit && (
              <Button onClick={() => updateStatus('PENDING_APPROVAL')} disabled={updating}>
                {updating ? '提交中...' : '提交审批'}
              </Button>
            )}
            {canApprove && (
              <Button onClick={() => updateStatus('APPROVED')} disabled={updating} variant="outline">
                {updating ? '审批中...' : '审批通过'}
              </Button>
            )}
            {canReject && (
              <Button onClick={() => updateStatus('REJECTED')} disabled={updating} variant="destructive">
                {updating ? '审批中...' : '审批驳回'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <ReviewPanel key={reviewTick} quoteId={quoteId} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">报价明细</CardTitle>
        </CardHeader>
        <CardContent>
          {!quote.quote_items || quote.quote_items.length === 0 ? (
            <p className="text-sm text-slate-500">暂无报价明细</p>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-slate-500">
                      <th className="text-left py-2 pr-3">SKU</th>
                      <th className="text-left py-2 pr-3">项目</th>
                      <th className="text-right py-2 pr-3">数量</th>
                      <th className="text-right py-2 pr-3">单价</th>
                      <th className="text-right py-2 pr-3">小计</th>
                    </tr>
                  </thead>
                  <tbody>
                    {quote.quote_items.map((item: QuoteItem) => (
                      <tr key={item.id} className="border-b last:border-b-0">
                        <td className="py-3 pr-3 font-mono text-xs text-slate-500">
                          {item.product_code || '自定义'}
                        </td>
                        <td className="py-3 pr-3">
                          <div className="font-medium text-slate-900">{item.name}</div>
                          <div className="text-xs text-slate-500">
                            {[
                              item.specification,
                              item.unit,
                              item.tier_range ? `阶梯 ${item.tier_range}` : null,
                              item.pricing_source ? `价格来源 ${pricingSourceMap[item.pricing_source] || item.pricing_source}` : null,
                            ].filter(Boolean).join(' · ') || '—'}
                          </div>
                        </td>
                        <td className="py-3 pr-3 text-right">{item.quantity}</td>
                        <td className="py-3 pr-3 text-right font-mono">¥{item.unit_price.toLocaleString()}</td>
                        <td className="py-3 pr-3 text-right font-mono">¥{item.line_total.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="ml-auto w-full max-w-sm space-y-2 rounded-lg border bg-slate-50 p-4 text-sm">
                <SummaryRow label="小计" value={`¥${(quote.subtotal || 0).toLocaleString()}`} />
                <SummaryRow label={`折扣 (${(quote.discount_rate || 0).toFixed(2)}%)`} value={`-¥${(quote.discount_amount || 0).toLocaleString()}`} />
                <SummaryRow label={`税额 (${(((quote.tax_rate || 0) as number) * 100).toFixed(0)}%)`} value={`¥${(quote.tax_amount || 0).toLocaleString()}`} />
                <SummaryRow label="总计" value={`¥${(quote.total_amount || 0).toLocaleString()}`} strong />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
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
