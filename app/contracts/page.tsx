'use client'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

const contracts = [
  { id: '1', filename: '合同-XX银行.pdf', customer: 'XX银行', status: 'PENDING' },
  { id: '2', filename: '合同-XX科技.docx', customer: 'XX科技', status: 'COMPLETED' },
  { id: '3', filename: '合同-XX集团.pdf', customer: 'XX集团', status: 'ANALYZING' },
]

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  PENDING: { label: '待审核', variant: 'secondary' },
  ANALYZING: { label: '审核中', variant: 'default' },
  COMPLETED: { label: '审核完成', variant: 'outline' },
  FAILED: { label: '审核失败', variant: 'destructive' },
}

export default function ContractsPage() {
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">合同审核</h1>
        <Link href="/contracts/new">
          <Button>+ 上传合同</Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>合同列表</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full">
            <thead>
              <tr className="border-b text-sm text-slate-500">
                <th className="text-left py-3 px-4">文件名</th>
                <th className="text-left py-3 px-4">客户</th>
                <th className="text-left py-3 px-4">状态</th>
                <th className="text-left py-3 px-4">操作</th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((contract) => (
                <tr key={contract.id} className="border-b hover:bg-slate-50">
                  <td className="py-3 px-4">{contract.filename}</td>
                  <td className="py-3 px-4">{contract.customer}</td>
                  <td className="py-3 px-4">
                    <Badge variant={statusMap[contract.status]?.variant || 'default'}>
                      {statusMap[contract.status]?.label || contract.status}
                    </Badge>
                  </td>
                  <td className="py-3 px-4">
                    <Link href={`/contracts/${contract.id}`} className="text-blue-600 hover:underline text-sm">
                      查看
                    </Link>
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
