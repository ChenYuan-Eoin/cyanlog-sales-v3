import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getAIConfigKind } from '@/lib/configs/ai-config-kind'
import type { AIPlatformAssetKind } from '@/lib/configs/types'
import type { Config } from '../types'
import { groupPlatformConfigRevisions, orderAndFilterReleaseConfigs } from './ai-config-presentation'

const source = readFileSync(resolve(process.cwd(), 'app/configs/tabs/AIConfigTab.tsx'), 'utf8')

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
  it('keeps the five administrator tasks in product order without masonry columns', () => {
    const labels = ['模型接入', '模型目录', 'AI 应用', '业务绑定', '发布状态']
    const offsets = labels.map((label) => source.indexOf(`label: '${label}'`))

    expect(offsets.every((offset) => offset >= 0)).toBe(true)
    expect(offsets).toEqual([...offsets].sort((left, right) => left - right))
    expect(source).not.toContain('columns-1')
    expect(source).not.toContain('break-inside-avoid')
  })

  it('keeps runtime evidence in a compact compatibility boundary instead of the main task flow', () => {
    expect(source).toContain('兼容运行边界')
    expect(source).toContain('配置发布不等于真实调用已经验证')
    expect(source).not.toContain('WP01')
    expect(source).not.toContain('WP02')
    expect(source).not.toContain('旧 AI_CONFIG')
    expect(source).not.toContain('旧 L1/L2/L3')
    expect(source).not.toContain('规则引擎兜底')
    expect(source).not.toContain('L1 本地模型优先')
  })

  it('uses a single intrinsic-height card flow so unequal cards cannot share row height', () => {
    expect(source).toContain('<IntrinsicCardStack label="Provider 连接列表">')
    expect(source).toContain('<IntrinsicCardStack label="模型目录列表">')
    expect(source).toContain('<IntrinsicCardStack label="业务用点列表">')
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
    expect(groups[0].primary.status).toBe('DRAFT')
    expect(source).toContain('版本与高级标识')
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

  it('keeps publish progress and feedback scoped to the triggering row', () => {
    const clientSource = readFileSync(resolve(process.cwd(), 'app/configs/ConfigsClient.tsx'), 'utf8')

    expect(clientSource).toContain('publishingConfigIdsRef.current.has(id)')
    expect(clientSource).toContain('setConfigPublishFeedback')
    expect(clientSource).toContain('请根据该行的依赖检查修正配置后重试')
    expect(source).toContain('PublishActionControl')
    expect(source).toContain('InlinePublishFeedback')
  })
})
