'use client'

import PriceListTab from './PriceListTab'
import RuleTab from './RuleTab'
import TaxTab from './TaxTab'
import ApprovalTab from './ApprovalTab'
import AIConfigTab from './AIConfigTab'
import ThemeTab from './ThemeTab'
import OrgStructureTab from './OrgStructureTab'
import RoleAccessTab from './RoleAccessTab'
import type { ProductRecord, Config, OrgSummaryPayload } from '../types'
import type { Rule } from '@/types/rules'

import { TableSkeleton, StatsSkeleton, CardSkeleton } from '@/components/ui/skeleton'

export interface TabsContentProps {
  activeTab: string
  loading?: boolean
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
  loading,
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
  if (loading) {
    // 骨架屏根据 tab 类型显示不同形态
    switch (activeTab) {
      case 'price-list':
      case 'rules':
        return (
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <StatsSkeleton count={3} />
            </div>
            <CardSkeleton />
            <TableSkeleton rows={5} />
          </div>
        )
      case 'org-structure':
        return (
          <div className="space-y-4">
            <StatsSkeleton count={3} />
            <div className="flex gap-6">
              <div className="w-[260px]">
                <CardSkeleton />
              </div>
              <div className="flex-1">
                <CardSkeleton />
              </div>
            </div>
          </div>
        )
      case 'role-access':
        return (
          <div className="flex gap-6">
            <div className="w-[280px]">
              <CardSkeleton />
            </div>
            <div className="flex-1">
              <CardSkeleton />
            </div>
          </div>
        )
      default:
        return (
          <div className="space-y-4">
            <StatsSkeleton count={3} />
            <CardSkeleton />
          </div>
        )
    }
  }

  switch (activeTab) {
    case 'price-list':
      return (
        <PriceListTab
          products={products}
          onNew={onNewProduct}
          onEdit={onEditProduct}
          onDelete={onDeleteProduct}
        />
      )
    case 'rules':
      return (
        <RuleTab
          rules={rules}
          onNew={onNewRule}
          onEdit={onEditRule}
          onDelete={onDeleteRule}
        />
      )
    case 'tax': {
      const taxConfigs = configs.filter((c) => c.type === 'TAX_RULE')
      return (
        <TaxTab
          configs={taxConfigs}
          onNew={() => onNewConfig('TAX_RULE')}
          onEdit={onEditConfig}
          onPublish={onPublishConfig}
          onVersions={onFetchVersions}
          onDelete={onDeleteConfig}
        />
      )
    }
    case 'approval': {
      const approvalConfigs = configs.filter((c) => c.type === 'APPROVAL_RULE')
      return (
        <ApprovalTab
          configs={approvalConfigs}
          onNew={() => onNewConfig('APPROVAL_RULE')}
          onEdit={onEditConfig}
          onPublish={onPublishConfig}
          onVersions={onFetchVersions}
          onDelete={onDeleteConfig}
        />
      )
    }
    case 'ai': {
      const aiConfigs = configs.filter((c) => c.type === 'AI_CONFIG')
      return (
        <AIConfigTab
          configs={aiConfigs}
          onNew={() => onNewConfig('AI_CONFIG')}
          onEdit={onEditConfig}
          onPublish={onPublishConfig}
          onDelete={onDeleteConfig}
        />
      )
    }
    case 'theme': {
      const themeConfigs = configs.filter((c) => c.type === 'UI_THEME')
      return (
        <ThemeTab
          configs={themeConfigs}
          onNew={() => onNewConfig('UI_THEME')}
          onEdit={onEditConfig}
          onPublish={onPublishConfig}
          onVersions={onFetchVersions}
          onDelete={onDeleteConfig}
        />
      )
    }
    case 'org-structure':
      return (
        <OrgStructureTab
          orgSummary={orgSummary}
          feishuSyncing={feishuSyncing}
          feishuResult={feishuResult}
          onFeishuSync={onFeishuSync}
        />
      )
    case 'role-access':
      return (
        <RoleAccessTab
          roles={roles}
          savingRoleId={savingRoleId}
          orgSummary={orgSummary}
          onSaveRole={onSaveRole}
        />
      )
    default:
      return null
  }
}
