import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getAIConfigKind } from '@/lib/configs/ai-config-kind'
import type { AIPlatformAssetKind } from '@/lib/configs/types'
import type { Config } from '../types'
import { groupPlatformConfigRevisions, orderAndFilterReleaseConfigs } from './ai-config-presentation'

const source = readFileSync(resolve(process.cwd(), 'app/configs/tabs/AIConfigTab.tsx'), 'utf8')
const runtimePresentationSource = readFileSync(
  resolve(process.cwd(), 'app/configs/tabs/ai-runtime-presentation.ts'),
  'utf8',
)
const runtimeStatusSource = readFileSync(
  resolve(process.cwd(), 'app/configs/tabs/ai-runtime-status.ts'),
  'utf8',
)

const dependencyOrder: AIPlatformAssetKind[] = [
  'provider_connection',
  'model_catalog_entry',
  'ai_application',
  'business_use_point',
  'route_policy',
  'application_binding',
]

function makeConfig(index: number, kind: AIPlatformAssetKind = 'provider_connection'): Config {
  return {
    id: `config-${index}`,
    key: `CONFIG_${index}`,
    name: `配置 ${String(index).padStart(2, '0')}`,
    type: 'AI_CONFIG',
    status: index % 2 === 0 ? 'PUBLISHED' : 'DRAFT',
    version: 1,
    value: {
      schema_version: 'ai-platform.v1',
      kind,
      asset_id: `${kind}.${index}`,
      runtime_location: 'cloud',
      base_url: `https://provider-${index}.example/v1`,
      enabled: true,
    },
    created_at: '2026-07-20T00:00:00.000Z',
    updated_at: '2026-07-20T00:00:00.000Z',
  }
}

describe('AI platform workspace source contract', () => {
  it('keeps the five business tasks in product order without masonry columns', () => {
    const labels = ['模型能力', '业务使用', '降级顺序', '实际执行', '发布与版本']
    const offsets = labels.map((label) => source.indexOf(`label: '${label}'`))

    expect(offsets.every((offset) => offset >= 0)).toBe(true)
    expect(offsets).toEqual([...offsets].sort((left, right) => left - right))
    expect(source).not.toContain('columns-1')
    expect(source).not.toContain('break-inside-avoid')
  })

  it('makes configured versus effective routes and real attempt evidence a dedicated human task', () => {
    expect(source).toContain('实际执行路线与真实结果')
    expect(source).toContain('管理员发布顺序')
    expect(source).toContain('本机实际路线')
    expect(source).toContain('托管实际路线')
    expect(source).toContain('item.environment_projections.local')
    expect(source).toContain('item.environment_projections.hosted')
    expect(source).toContain('排除发生在调用前，不计为失败或降级')
    expect(runtimePresentationSource).toContain('当前计划真实通过')
    expect(source).toContain('真实模型尝试')
    expect(source).toContain('模型用量')
    expect(source).toContain('独立金标准确度仍需回到对应产品功能单独验收')
    expect(source).toContain('历史成功不能证明当前模型可用')
    expect(source).toContain('不会绕过配置选择其他模型')
    expect(source).toContain('不计入当前发布路由的通过或失败')
    expect(runtimeStatusSource).toContain('检查最新状态')
    expect(source).toContain('历史配置边界')
    expect(source).not.toContain('runtimePolicy')
    expect(source).not.toContain('provider_chain')
    expect(source).not.toContain('ModelPolicy')
    expect(source).not.toContain('WP01')
    expect(source).not.toContain('WP02')
    expect(source).not.toContain('旧 AI_CONFIG')
    expect(source).not.toContain('旧 L1/L2/L3')
    expect(source).not.toContain('规则引擎兜底')
    expect(source).not.toContain('L1 本地模型优先')
  })

  it('derives business usability from the runtime plan and keeps four status layers separate', () => {
    expect(source).toContain("const readyPlan = runtimeItem?.plan.state === 'ready' ? runtimeItem.plan : null")
    expect(source).toContain('配置到业务验收的四层状态')
    expect(source).toContain('1. 配置发布')
    expect(source).toContain('2. 当前环境')
    expect(source).toContain('3. 模型调用')
    expect(source).toContain('4. 业务结果')
    expect(source).toContain('回到对应功能验收')
    expect(source).not.toContain("ready = Boolean(usePoint && binding && application && route)")
    expect(source).not.toContain('已接入 AI')
  })

  it('only accepts model evidence for the current plan and exact published model service pair', () => {
    expect(source).toContain('attempt.matches_current_plan')
    expect(source).toContain('attempt.model_catalog_entry_id === publishedModelAssetId')
    expect(source).toContain('attempt.provider_connection_id === publishedProviderAssetId')
    expect(source).toContain("const publishedModel = modelGroup.published[0]")
    expect(source).toContain("const publishedProvider = providerGroup?.published[0]")
  })

  it('keeps invocation and ReviewRun identifiers inside the folded audit section', () => {
    const auditSummaryOffset = source.indexOf('>审计标识</summary>')
    const invocationOffset = source.indexOf('<div>Invocation:')
    const reviewRunOffset = source.indexOf('<div>ReviewRun:')

    expect(auditSummaryOffset).toBeGreaterThan(0)
    expect(invocationOffset).toBeGreaterThan(auditSummaryOffset)
    expect(reviewRunOffset).toBeGreaterThan(auditSummaryOffset)
    expect(runtimeStatusSource).toContain('已关联本次审核记录，业务结果可以追溯')
    expect(runtimeStatusSource).not.toContain('已绑定 ReviewRun')
  })

  it('distinguishes plan readiness, real success, fallback, failure and unavailable evidence', () => {
    expect(runtimePresentationSource).toContain("label: '当前计划真实通过'")
    expect(runtimePresentationSource).toContain("label: '降级后真实通过'")
    expect(runtimePresentationSource).toContain("label: '最近真实调用失败'")
    expect(runtimePresentationSource).toContain("label: '调用证据不完整'")
    expect(runtimePresentationSource).toContain("label: '当前计划未验证'")
    expect(runtimePresentationSource).toContain("label: '当前验证已过期'")
    expect(runtimePresentationSource).toContain("label: '真实证据不可读'")
    expect(runtimePresentationSource).toContain("label: '当前环境暂不可执行'")
    expect(source).toContain('aria-live="polite"')
  })

  it('versions and validates runtime browser cache before rendering the new contract', () => {
    const clientSource = readFileSync(resolve(process.cwd(), 'app/configs/ConfigsClient.tsx'), 'utf8')

    expect(clientSource).toContain("'configs:ai-runtime:v1'")
    expect(clientSource).toContain('isAIRuntimeOverview(cachedRuntimeEntry?.value)')
    expect(clientSource).toContain('AI 运行证据结构版本不兼容')
  })

  it('uses a single intrinsic-height card flow so unequal cards cannot share row height', () => {
    expect(source).toContain('<IntrinsicCardStack label="模型服务连接列表">')
    expect(source).toContain('<IntrinsicCardStack label="可用模型列表">')
    expect(source).toContain('<IntrinsicCardStack label="产品功能入口列表">')
    expect(source).not.toContain('grid items-start gap-3 xl:grid-cols-2')
    expect(source).not.toContain('grid items-start gap-3 lg:grid-cols-2')
  })

  it('aggregates physical revisions into one logical asset timeline', () => {
    const records = [
      { ...makeConfig(1), status: 'DRAFT' as const, version: 3, updated_at: '2026-07-20T03:00:00.000Z' },
      { ...makeConfig(2), status: 'PUBLISHED' as const, version: 2, updated_at: '2026-07-20T02:00:00.000Z' },
      { ...makeConfig(3), status: 'ARCHIVED' as const, version: 1, updated_at: '2026-07-20T01:00:00.000Z' },
    ].map((config) => ({
      ...config,
      value: { ...config.value, asset_id: 'provider.connection.shared' },
    }))

    const groups = groupPlatformConfigRevisions(records)
    expect(groups).toHaveLength(1)
    expect(groups[0].records).toHaveLength(3)
    expect(groups[0].drafts).toHaveLength(1)
    expect(groups[0].published).toHaveLength(1)
    expect(groups[0].archived).toHaveLength(1)
    expect(groups[0].primary.status).toBe('PUBLISHED')
    expect(source).toContain('草稿尚未影响当前业务')
    expect(source).toContain('actionTarget = group.drafts[0] || group.primary')
    expect(source).toContain('查看版本与审计标识')
    expect(source).toContain('稳定配置编号')
  })

  it('sorts a 50-item release list by dependency topology before filtering', () => {
    const configs = Array.from({ length: 50 }, (_, index) => (
      makeConfig(index, dependencyOrder[(49 - index) % dependencyOrder.length])
    ))
    const ordered = orderAndFilterReleaseConfigs(configs, '', 'ALL')
    const orderNumbers = ordered.map((config) => dependencyOrder.indexOf(getAIConfigKind(config.value) as AIPlatformAssetKind))

    expect(ordered).toHaveLength(50)
    expect(orderNumbers).toEqual([...orderNumbers].sort((left, right) => left - right))
    expect(orderAndFilterReleaseConfigs(configs, '配置 07', 'ALL')).toHaveLength(1)
    expect(orderAndFilterReleaseConfigs(configs, '', 'DRAFT')).toHaveLength(25)
  })

  it('keeps compact horizontal navigation ahead of the full desktop navigation', () => {
    const clientSource = readFileSync(resolve(process.cwd(), 'app/configs/ConfigsClient.tsx'), 'utf8')

    expect(clientSource).toContain('aria-label="配置域快捷导航"')
    expect(clientSource).toContain('xl:hidden')
    expect(clientSource).toContain('hidden self-start xl:sticky xl:top-8 xl:block')
    expect(source).toContain('overflow-x-auto pb-1 xl:grid')
  })

  it('removes misleading AI object totals and names the real product consumers', () => {
    const clientSource = readFileSync(resolve(process.cwd(), 'app/configs/ConfigsClient.tsx'), 'utf8')

    expect(clientSource).toContain("case 'ai':")
    expect(clientSource).toContain('return []')
    expect(clientSource).toContain('报价 / 合同 / 标书')
    expect(clientSource).toContain('formatModuleCount(tabId)} 项')
    expect(source).not.toContain('const counts: Record<AIWorkspaceView, number>')
  })

  it('folds detailed business adjustments behind the plan-derived overview', () => {
    expect(source).toContain('调整产品功能与 AI 能力的详细配置')
    expect(source.indexOf('业务使用总览')).toBeLessThan(source.indexOf('调整产品功能与 AI 能力的详细配置'))
  })

  it('keeps publish progress and feedback scoped to the triggering row', () => {
    const clientSource = readFileSync(resolve(process.cwd(), 'app/configs/ConfigsClient.tsx'), 'utf8')

    expect(clientSource).toContain('publishingConfigIdsRef.current.has(id)')
    expect(clientSource).toContain('setConfigPublishFeedback')
    expect(clientSource).toContain('请根据该行的依赖检查修正配置后重试')
    expect(source).toContain('PublishActionControl')
    expect(source).toContain('InlinePublishFeedback')
  })

  it('uses business configuration language in the release workspace', () => {
    expect(source).toContain('每类配置独立发布')
    expect(source).toContain('搜索待发布配置')
    expect(source).toContain('按名称或配置编号搜索')
    expect(source).toContain('还没有平台配置')
    expect(source).not.toContain('搜索发布资产')
    expect(source).not.toContain('按名称、配置编号或资产 ID 搜索')
  })
})
