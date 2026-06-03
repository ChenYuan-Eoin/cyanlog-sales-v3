'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

interface Contract {
  id: string
  filename: string
  status: string
  size: number
  created_at: string
}

export default function ContractsPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchContracts() {
      try {
        const token = localStorage.getItem('token')
        const res = await fetch('/api/contracts', {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        })
        if (res.ok) {
          const data = await res.json()
          setContracts(data.data || [])
        }
      } catch (error) {
        console.error('获取合同失败:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchContracts()
  }, [])

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">合同审核</h1>
        <Link href="/contracts/new">
          <Button>+ 上传合同</Button>
        </Link>
      </div>

      {loading ? (
        <div className="text-slate-500">加载中...</div>
      ) : contracts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-slate-500 mb-4">暂无合同</p>
            <Link href="/contracts/new">
              <Button>+ 上传合同</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>合同列表</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b text-sm text-slate-500">
                    <th className="text-left py-3 px-4">文件名</th>
                    <th className="text-left py-3 px-4">大小</th>
                    <th className="text-left py-3 px-4">状态</th>
                    <th className="text-left py-3 px-4">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {contracts.map((contract) => (
                    <tr key={contract.id} className="border-b hover:bg-slate-50">
                      <td className="py-3 px-4">{contract.filename}</td>
                      <td className="py-3 px-4 text-sm text-slate-500">
                        {(contract.size / 1024 / 1024).toFixed(2)} MB
                      </td>
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
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  PENDING: { label: '待审核', variant: 'secondary' },
  PARSING: { label: '解析中', variant: 'default' },
  ANALYZING: { label: '审核中', variant: 'default' },
  COMPLETED: { label: '审核完成', variant: 'outline' },
  FAILED: { label: '审核失败', variant: 'destructive' },
}
