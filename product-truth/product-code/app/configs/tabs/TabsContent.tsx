'use client'

import dynamic from 'next/dynamic'
import { Suspense } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ProductRecord, Config, OrgSummaryPayload } from '../types'
import type { Rule } from '@/types/rules'

// 动态导入标签页组件
const PriceListTab = dynamic(() => import('./PriceListTab'), { ssr: false })
const RuleTab = dynamic(() => import('./RuleTab'), { ssr: false })
const TaxTab = dynamic(() => import('./TaxTab'), { ssr: false })
const ApprovalTab = dynamic(() => import('./ApprovalTab'), { ssr: false })
const AIConfigTab = dynamic(() => import('./AIConfigTab'), { ssr: false })
const ThemeTab = dynamic(() => import('./ThemeTab'), { ssr: false })
const OrgStructureTab = dynamic(() => import('./OrgStructureTab'), { ssr: false })
const RoleAccessTab = dynamic(() => import('./RoleAccessTab'), { ssr: false })

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

export interface TabsContentProps {
  activeTab: string
  // price-list
  products: ProductRecord[]
  onNewProduct: () => void
  onEditProduct: (product: ProductRecord) => void
  onDeleteProduct: (id: string) => void
  // rules
  rules: Rule[]
  onNewRule: () => void
  onEditRule: (rule: Rule) => void
  onDeleteRule: (id: string) => void
  // config-based tabs (tax, approval, ai, theme)
  configs: Config[]
  onNewConfig: (type: Config['type']) => void
  onEditConfig: (config: Config) => void
  onPublishConfig: (id: string) => void
  onFetchVersions: (id: string) => void
  onDeleteConfig: (id: string) => void
  // org-structure
  orgSummary: OrgSummaryPayload | null
  feishuSyncing: boolean
  feishuResult: string
  onFeishuSync: () => void
  // role-access
  roles: Array<{
    id: string
    code: string
    name: string
    description: string | null
    permissions: string[] | null
    sort_order: number | null
  }>
  savingRoleId: string | null
  onSaveRole: (roleId: string, newPerms: string[]) => void
}

export default function TabsContent({
  activeTab,
  products,
  onNewProduct,
  onEditProduct,
  onDeleteProduct,
  rules,
  onNewRule,
  onEditRule,
  onDeleteRule,
  configs,
  onNewConfig,
  onEditConfig,
  onPublishConfig,
  onFetchVersions,
  onDeleteConfig,
  orgSummary,
  feishuSyncing,
  feishuResult,
  onFeishuSync,
  roles,
  savingRoleId,
  onSaveRole,
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
    case 'tax': {
      const taxConfigs = configs.filter((c) => c.type === 'TAX_RULE')
      return (
        <Suspense fallback={<TabSkeleton title="税率规则" />}>
          <TaxTab
            configs={taxConfigs}
            onNew={() => onNewConfig('TAX_RULE')}
            onEdit={onEditConfig}
            onPublish={onPublishConfig}
            onVersions={onFetchVersions}
            onDelete={onDeleteConfig}
          />
        </Suspense>
      )
    }
    case 'approval': {
      const approvalConfigs = configs.filter((c) => c.type === 'APPROVAL_RULE')
      return (
        <Suspense fallback={<TabSkeleton title="审批权限" />}>
          <ApprovalTab
            configs={approvalConfigs}
            onNew={() => onNewConfig('APPROVAL_RULE')}
            onEdit={onEditConfig}
            onPublish={onPublishConfig}
            onVersions={onFetchVersions}
            onDelete={onDeleteConfig}
          />
        </Suspense>
      )
    }
    case 'ai': {
      const aiConfigs = configs.filter((c) => c.type === 'AI_CONFIG')
      return (
        <Suspense fallback={<TabSkeleton title="AI 模型配置" />}>
          <AIConfigTab
            configs={aiConfigs}
            onNew={() => onNewConfig('AI_CONFIG')}
            onEdit={onEditConfig}
            onPublish={onPublishConfig}
            onDelete={onDeleteConfig}
          />
        </Suspense>
      )
    }
    case 'theme': {
      const themeConfigs = configs.filter((c) => c.type === 'UI_THEME')
      return (
        <Suspense fallback={<TabSkeleton title="运行时主题" />}>
          <ThemeTab
            configs={themeConfigs}
            onNew={() => onNewConfig('UI_THEME')}
            onEdit={onEditConfig}
            onPublish={onPublishConfig}
            onVersions={onFetchVersions}
            onDelete={onDeleteConfig}
          />
        </Suspense>
      )
    }
    case 'org-structure':
      return (
        <Suspense fallback={<TabSkeleton title="组织架构" />}>
          <OrgStructureTab
            orgSummary={orgSummary}
            feishuSyncing={feishuSyncing}
            feishuResult={feishuResult}
            onFeishuSync={onFeishuSync}
          />
        </Suspense>
      )
    case 'role-access':
      return (
        <Suspense fallback={<TabSkeleton title="角色权限" />}>
          <RoleAccessTab
            roles={roles}
            savingRoleId={savingRoleId}
            orgSummary={orgSummary}
            onSaveRole={onSaveRole}
          />
        </Suspense>
      )
    default:
      return <TabSkeleton title="功能开发中" />
  }
}
