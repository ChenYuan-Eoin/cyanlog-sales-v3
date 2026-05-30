'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

const quotes = [
  { id: '1', quoteNo: 'QT-20240524-0001', customer: 'XX银行', amount: '¥50,000', status: 'DRAFT' },
  { id: '2', quoteNo: 'QT-20240524-0002', customer: 'XX科技', amount: '¥120,000', status: 'PENDING_APPROVAL' },
  { id: '3', quoteNo: 'QT-20240524-0003', customer: 'XX集团', amount: '¥80,000', status: 'APPROVED' },
]

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  DRAFT: { label: '草稿', variant: 'secondary' },
  PENDING_APPROVAL: { label: '审批中', variant: 'default' },
  APPROVED: { label: '已批准', variant: 'outline' },
}

export default function QuotesPage() {
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">报价中心</h1>
        <Link href="/quotes/new">
          <Button>+ 新建报价</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>报价列表</CardTitle>
        </CardHeader>
        <CardContent>
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
                  <td className="py-3 px-4 font-mono text-sm">{quote.quoteNo}</td>
                  <td className="py-3 px-4">{quote.customer}</td>
                  <td className="py-3 px-4">{quote.amount}</td>
                  <td className="py-3 px-4">
                    <Badge variant={statusMap[quote.status]?.variant || 'default'}>
                      {statusMap[quote.status]?.label || quote.status}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  )
}
