'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import type { Quote } from '@/types'

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  DRAFT: { label: '草稿', variant: 'secondary' },
  PENDING_APPROVAL: { label: '审批中', variant: 'default' },
  APPROVED: { label: '已批准', variant: 'outline' },
  REJECTED: { label: '已驳回', variant: 'destructive' },
}

export default function QuoteDetailPage() {
  const params = useParams()
  const [quote, setQuote] = useState<Quote | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState(false)

  const quoteId = params.id as string

  useEffect(() => {
    fetchQuote()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteId])

  async function fetchQuote() {
    try {
      const token = localStorage.getItem('token')
      const res = await fetch(`/api/quotes/${quoteId}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      })

      if (!res.ok) {
        if (res.status === 404) setError('报价单不存在')
        else if (res.status === 401) setError('未登录或登录已过期')
        else setError('获取报价失败')
        return
      }

      const data = await res.json()
      setQuote(data)
    } catch {
      setError('网络错误，请稍后重试')
    } finally {
      setLoading(false)
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
        setError(data.error || '操作失败')
        setUpdating(false)
        return
      }

      await fetchQuote()
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
              <span className="text-slate-500">创建时间：</span>
              <span>{new Date(quote.created_at).toLocaleString('zh-CN')}</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-6 pt-4 border-t flex gap-4">
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
    </div>
  )
}
