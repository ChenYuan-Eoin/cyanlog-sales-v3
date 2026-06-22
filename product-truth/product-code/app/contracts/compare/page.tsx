'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { FileTextIcon, ArrowLeftIcon, GitCompareIcon } from 'lucide-react'
import { LoadingState } from '@/components/ui/LoadingState'
import { handleError } from '@/lib/toast'

interface Contract {
  id: string
  filename: string
  status: string
  created_at: string
}

export default function ContractCompareSelectPage() {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchContracts() {
      try {
        const token = localStorage.getItem('token')
        const res = await fetch('/api/contracts?page=1&pageSize=20', {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        if (res.ok) {
          const data = await res.json()
          setContracts(data.data?.data || [])
        }
      } catch (err) {
        handleError(err, '加载合同列表失败')
      } finally {
        setLoading(false)
      }
    }
    void fetchContracts()
  }, [])

  if (loading) {
    return (
      <div className="min-h-full bg-slate-50 flex items-center justify-center">
        <LoadingState message="加载合同列表..." />
      </div>
    )
  }

  return (
    <div className="min-h-full bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/contracts">
            <Button variant="ghost" size="icon">
              <ArrowLeftIcon className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold">文档比对</h1>
            <p className="text-sm text-slate-500">选择一个合同进行标准条款比对</p>
          </div>
        </div>

        {/* Contract List */}
        {contracts.length === 0 ? (
          <div className="text-center py-12">
            <FileTextIcon className="h-12 w-12 text-slate-300 mx-auto mb-4" />
            <p className="text-slate-500">暂无合同</p>
            <p className="text-sm text-slate-400 mt-1">请先上传或创建合同</p>
            <Link href="/contracts/upload" className="inline-block mt-4">
              <Button>上传合同</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-slate-500 mb-4">共 {contracts.length} 个合同，选择其中一个进行比对：</p>
            {contracts.map((contract) => (
              <Link key={contract.id} href={`/contracts/${contract.id}/compare`}>
                <Card className="hover:shadow-sm hover:border-indigo-200 transition-all cursor-pointer">
                  <CardContent className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                        <FileTextIcon className="h-5 w-5 text-slate-400" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-slate-900 text-sm truncate">{contract.filename || '未命名合同'}</p>
                        <p className="text-xs text-slate-400">
                          {new Date(contract.created_at).toLocaleDateString('zh-CN')}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <GitCompareIcon className="h-4 w-4 text-slate-400" />
                        <span className="text-sm text-slate-500">开始比对</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
