'use client'

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import type { AIRuntimeOverview, ProductRecord, Config, ConfigPublishFeedback, OrgSummaryPayload } from '../types'
import type { ContractPolicyRule } from '@/types/rules'
import type { AIPlatformAssetKind } from '@/lib/configs/types'

import { TableSkeleton, StatsSkeleton, CardSkeleton } from '@/components/ui/skeleton'
import type { RoleModulePermissionCatalog } from '@/lib/org-role-permission-readback'

const ShippingConfigDrawer = dynamic(() => import('@/app/shipping/config-drawer'), {
  loading: () => <CardSkeleton />,
})

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
const OrganizationSourcePanel = dynamic(() => import('./OrganizationSourcePanel').then(module => module.OrganizationSourcePanel), {
  loading: () => <CardSkeleton />,
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

const ConfigCenterTab = dynamic(() => import('./ConfigCenterTab'), {
  loading: () => <CardSkeleton />,
})
const PriceMatrixImportTab = dynamic(() => import('./PriceMatrixImportTab'), {
  loading: () => <CardSkeleton />,
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
  onRefreshOrg: () => void | Promise<void>
  onOpenIntegrations?: () => void
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
  permissionsEditable?: boolean
  modulePermissionCatalog?: RoleModulePermissionCatalog
  permissionsEditBlockReason?: string | null
  orgSuperAdminAuthority?: { orgId: string }
  onSaveRole: (roleId: string, newPerms: string[], ownerShippingPermissions?: string[]) => void
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
  onRefreshOrg,
  onOpenIntegrations,
  roles,
  savingRoleId,
  permissionsEditable,
  modulePermissionCatalog,
  permissionsEditBlockReason,
  orgSuperAdminAuthority,
  onSaveRole,
}: TabsContentProps) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)

  useEffect(() => {
    if (activeTab !== 'org-structure' && activeTab !== 'role-access') return
    const controller = new AbortController()
    let token: string | null = null
    try { token = localStorage.getItem('token') } catch { token = null }

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
  }, [activeTab])

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
      case 'integrations':
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
    case 'shipping':
      return <ShippingConfigDrawer embedded />
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
          onRefresh={onRefreshOrg}
          onOpenIntegrations={onOpenIntegrations}
        />
      )
    case 'integrations':
      return (
        <div className="mx-auto w-full max-w-5xl">
          <OrganizationSourcePanel onRefresh={onRefreshOrg} />
        </div>
      )
    case 'role-access':
      return (
        <RoleAccessTab
          roles={roles}
          currentUserId={currentUserId}
          savingRoleId={savingRoleId}
          permissionsEditable={permissionsEditable}
          modulePermissionCatalog={modulePermissionCatalog}
          permissionsEditBlockReason={permissionsEditBlockReason}
          orgSuperAdminAuthority={orgSuperAdminAuthority}
          orgSummary={orgSummary}
          onSaveRole={onSaveRole}
          onRefresh={onRefreshOrg}
        />
      )
    case 'business-params':
      return <ConfigCenterTab domain="business-params" title="业务参数" description="所有业务数字以参数维护，默认值=现行业务值。" />
    case 'product-versions':
      return <ConfigCenterTab domain="product-versions" title="版本能力矩阵" description="版本×部署×授权×能力标签。" />
    case 'price-matrix':
      return <ConfigCenterTab domain="price-matrix" title="多维价盘" description="产品×版本×部署×授权×期限×区间；累计+边际两口径。" />
    case 'price-matrix-import':
      return <PriceMatrixImportTab />
    case 'approval-chains':
      return <ConfigCenterTab domain="approval-chains" title="审批链" description="串行/并行、收口方式、节点指派角色/组织/关系。" />
    case 'approval-rules':
      return <ConfigCenterTab domain="approval-rules" title="审批规则" description="场景×条件→审批链；多条命中按优先级取最严。" />
    case 'field-dictionary':
      return <ConfigCenterTab domain="field-dictionary" title="字段字典" description="字段即规则；内部字段永不输出。" />
    case 'output-templates':
      return <ConfigCenterTab domain="output-templates" title="输出模板" description="标准/客户模板与匹配规则。" />
    case 'clause-mappings':
      return <ConfigCenterTab domain="clause-mappings" title="条款映射" description="方案属性→条款/协议。" />
    case 'numbering-rules':
      return <ConfigCenterTab domain="numbering-rules" title="单号规则" description="编号模板，唯一可回溯。" />
    default:
      return null
  }
}
