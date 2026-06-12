'use client'

import dynamic from 'next/dynamic'
import { Suspense } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ProductRecord } from '../types'
import type { Rule } from '@/types/rules'

// 动态导入标签页
const PriceListTab = dynamic(() => import('./PriceListTab'), {
  loading: () => <TabSkeleton title="价盘与阶梯价" />,
  ssr: false,
})

const RuleTab = dynamic(() => import('./RuleTab'), {
  loading: () => <TabSkeleton title="合同审核规则" />,
  ssr: false,
})

function TabSkeleton({ title }: { title: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="h-4 w-full bg-slate-200 rounded animate-pulse" />
        <div className="h-4 w-3/4 bg-slate-200 rounded animate-pulse" />
        <div className="h-4 w-1/2 bg-slate-200 rounded animate-pulse" />
      </CardContent>
    </Card>
  )
}

interface TabsContentProps {
  activeTab: string
  products: ProductRecord[]
  rules: Rule[]
  onNewProduct: () => void
  onEditProduct: (product: ProductRecord) => void
  onDeleteProduct: (id: string) => void
  onNewRule: () => void
  onEditRule: (rule: Rule) => void
  onDeleteRule: (id: string) => void
}

export default function TabsContent({
  activeTab,
  products,
  rules,
  onNewProduct,
  onEditProduct,
  onDeleteProduct,
  onNewRule,
  onEditRule,
  onDeleteRule,
}: TabsContentProps) {
  switch (activeTab) {
    case 'price-list':
      return (
        <Suspense fallback={<TabSkeleton title="价盘与阶梯价" />}>
          <PriceListTab
            products={products}
            onNew={onNewProduct}
            onEdit={onEditProduct}
            onDelete={onDeleteProduct}
          />
        </Suspense>
      )
    case 'rules':
      return (
        <Suspense fallback={<TabSkeleton title="合同审核规则" />}>
          <RuleTab
            rules={rules}
            onNew={onNewRule}
            onEdit={onEditRule}
            onDelete={onDeleteRule}
          />
        </Suspense>
      )
    default:
      return <TabSkeleton title="功能开发中" />
  }
}
