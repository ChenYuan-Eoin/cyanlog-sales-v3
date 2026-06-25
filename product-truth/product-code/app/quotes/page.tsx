'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'
import { LoadingState } from '@/components/ui/LoadingState'
import { EmptyState } from '@/components/ui/EmptyState'
import { FileTextIcon } from 'lucide-react'

interface Quote {
  id: string
  quote_no: string
  customer_name: string
  status: string
  total_amount: number
  created_at: string
}

export default function QuotesPage() {
  const router = useRouter()
  const [quotes, setQuotes] = useState<Quote[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchQuotes() {
      try {
        const token = localStorage.getItem('token')
        const res = await fetch('/api/quotes', {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        })
        if (res.ok) {
          const data = await res.json()
          setQuotes(data.data || [])
        }
      } catch (error) {
        console.error('获取报价失败:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchQuotes()
  }, [])

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">报价中心</h1>
        <Link href="/quotes/new">
          <Button>+ 新建报价</Button>
        </Link>
      </div>

      {loading ? (
        <LoadingState message="加载报价单..." />
      ) : quotes.length === 0 ? (
        <EmptyState
          title="暂无报价单"
          description="报价单是销售流程的核心文档，记录产品、价格、条款等关键信息。"
          icon={FileTextIcon}
          action={{
            label: '+ 新建报价',
            onClick: () => router.push('/quotes/new'),
          }}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>报价列表</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-sm text-slate-500">
                    <th className="text-left py-3 px-4">报价单号</th>
                    <th className="text-left py-3 px-4">客户</th>
                    <th className="text-left py-3 px-4">金额</th>
                    <th className="text-left py-3 px-4">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {quotes.map((quote) => (
                    <tr key={quote.id} className="border-b hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono text-sm">
                        <Link href={`/quotes/${quote.id}`} className="text-blue-600 hover:underline">
                          {quote.quote_no}
                        </Link>
                      </td>
                      <td className="py-3 px-4">{quote.customer_name}</td>
                      <td className="py-3 px-4">¥{(quote.total_amount || 0).toLocaleString()}</td>
                      <td className="py-3 px-4">
                        <Badge variant={statusMap[quote.status]?.variant || 'default'}>
                          {statusMap[quote.status]?.label || quote.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  DRAFT: { label: '草稿', variant: 'secondary' },
  PENDING_APPROVAL: { label: '审批中', variant: 'default' },
  APPROVED: { label: '已批准', variant: 'outline' },
  REJECTED: { label: '已驳回', variant: 'destructive' },
}
