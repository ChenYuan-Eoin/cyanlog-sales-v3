'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import type { AIRuntimeOverview, ProductRecord, Config, ConfigPublishFeedback, OrgSummaryPayload, FeishuSyncFeedback } from '../types'
import type { ContractPolicyRule } from '@/types/rules'
import type { AIPlatformAssetKind } from '@/lib/configs/types'

import { TableSkeleton, StatsSkeleton, CardSkeleton } from '@/components/ui/skeleton'

const PriceListTab = dynamic(() => import('./PriceListTab'), {
  loading: () => <CardSkeleton />,
})
const RuleTab = dynamic(() => import('./RuleTab'), {
  loading: () => <CardSkeleton />,
})
const TaxTab = dynamic(() => import('./TaxTab'), {
  loading: () => <CardSkeleton />,
})
const ApprovalTab = dynamic(() => import('./ApprovalTab'), {
  loading: () => <CardSkeleton />,
})
const AIConfigTab = dynamic(() => import('./AIConfigTab'), {
  loading: () => <CardSkeleton />,
})
const ThemeTab = dynamic(() => import('./ThemeTab'), {
  loading: () => <CardSkeleton />,
})
const OrgStructureTab = dynamic(() => import('./OrgStructureTab'), {
  loading: () => (
    <div className="space-y-4">
      <StatsSkeleton count={3} />
      <CardSkeleton />
    </div>
  ),
})
const RoleAccessTab = dynamic(() => import('./RoleAccessTab'), {
  loading: () => (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)_300px]">
      <CardSkeleton />
      <CardSkeleton />
      <CardSkeleton />
    </div>
  ),
})

export interface TabsContentProps {
  activeTab: string
  loading?: boolean
  // price-list
  products: ProductRecord[]
  onNewProduct: () => void
  onEditProduct: (product: ProductRecord) => void
  onDeleteProduct: (id: string) => void
  // rules
  rules: ContractPolicyRule[]
  focusRuleId?: string | null
  ruleMode?: string | null
  onSaveRule: (rule: Partial<ContractPolicyRule>, id?: string) => void | ContractPolicyRule | Promise<void | ContractPolicyRule>
  onDeleteRule: (id: string) => Promise<boolean>
  onRefreshRules?: () => void | Promise<void>
  // config-based tabs (tax, approval, ai, theme)
  configs: Config[]
  aiRuntimeOverview: AIRuntimeOverview | null
  aiRuntimeError: string
  onNewConfig: (type: Config['type'], aiKind?: AIPlatformAssetKind) => void
  onEditConfig: (config: Config) => void
  onReviseConfig: (config: Config) => void
  onPublishConfig: (id: string) => void
  publishingConfigIds: ReadonlySet<string>
  configPublishFeedback: Record<string, ConfigPublishFeedback | undefined>
  onFetchVersions: (id: string) => void
  onDeleteConfig: (id: string) => void
  onRefreshConfigs?: () => void | Promise<void>
  // org-structure
  orgSummary: OrgSummaryPayload | null
  feishuSyncing: boolean
  feishuFeedback: FeishuSyncFeedback | null
  onFeishuSync: () => void | Promise<void>
  onRefreshOrg: () => void | Promise<void>
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
  focusRuleId,
  ruleMode,
  onSaveRule,
  onDeleteRule,
  onRefreshRules,
  configs,
  aiRuntimeOverview,
  aiRuntimeError,
  onNewConfig,
  onEditConfig,
  onReviseConfig,
  onPublishConfig,
  publishingConfigIds,
  configPublishFeedback,
  onFetchVersions,
  onDeleteConfig,
  onRefreshConfigs,
  orgSummary,
  feishuSyncing,
  feishuFeedback,
  onFeishuSync,
  onRefreshOrg,
  roles,
  savingRoleId,
  onSaveRole,
}: TabsContentProps) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const token = localStorage.getItem('token')

    void fetch('/api/auth/me', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null
        const payload = await response.json() as { user?: { id?: unknown } }
        return typeof payload.user?.id === 'string' ? payload.user.id : null
      })
      .then((userId) => {
        if (!controller.signal.aborted) {
          setCurrentUserId(userId)
        }
      })
      .catch(() => {
        // Fail closed: role mutation UIs remain disabled until identity is known.
      })

    return () => controller.abort()
  }, [])

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
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[280px_minmax(0,1fr)_300px]">
              <CardSkeleton />
              <CardSkeleton />
              <CardSkeleton />
            </div>
          </div>
        )
      case 'role-access':
        return (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)_300px]">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
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
          focusRuleId={focusRuleId}
          ruleMode={ruleMode}
          onSave={onSaveRule}
          onDelete={onDeleteRule}
          onRefresh={onRefreshRules}
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
          runtimeOverview={aiRuntimeOverview}
          runtimeError={aiRuntimeError}
          onRefreshRuntime={onRefreshConfigs || (() => undefined)}
          onNew={(kind) => onNewConfig('AI_CONFIG', kind)}
          onEdit={onEditConfig}
          onRevise={onReviseConfig}
          onPublish={onPublishConfig}
          publishingConfigIds={publishingConfigIds}
          publishFeedback={configPublishFeedback}
          onVersions={onFetchVersions}
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
          onRefresh={onRefreshConfigs}
        />
      )
    }
    case 'org-structure':
      return (
        <OrgStructureTab
          orgSummary={orgSummary}
          currentUserId={currentUserId}
          feishuSyncing={feishuSyncing}
          feishuFeedback={feishuFeedback}
          onFeishuSync={onFeishuSync}
          onRefresh={onRefreshOrg}
        />
      )
    case 'role-access':
      return (
        <RoleAccessTab
          roles={roles}
          currentUserId={currentUserId}
          savingRoleId={savingRoleId}
          orgSummary={orgSummary}
          onSaveRole={onSaveRole}
          onRefresh={onRefreshOrg}
        />
      )
    default:
      return null
  }
}
