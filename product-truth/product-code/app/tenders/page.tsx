'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import Link from 'next/link'

export default function TendersPage() {
  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">标书中心</h1>
        <Link href="/tenders/new">
          <Button>+ 新建标书</Button>
        </Link>
      </div>

      <Card>
        <CardContent className="py-12 text-center">
          <p className="text-slate-500 mb-4">暂无标书</p>
          <p className="text-sm text-slate-400 mb-4">标书中心用于管理和生成投标文件</p>
          <Link href="/tenders/new">
            <Button>+ 新建标书</Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
