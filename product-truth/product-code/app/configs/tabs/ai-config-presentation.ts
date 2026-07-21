import { getAIConfigKind, isAIPlatformAssetKind } from '@/lib/configs/ai-config-kind'
import type { AIPlatformAssetKind } from '@/lib/configs/types'
import type { Config } from '../types'

export const AI_PLATFORM_KIND_LABELS: Record<AIPlatformAssetKind, string> = {
  provider_connection: '模型服务',
  model_catalog_entry: '可用模型',
  ai_application: 'AI 能力',
  business_use_point: '产品功能入口',
  application_binding: '业务能力选择',
  route_policy: '模型降级顺序',
}

const RELEASE_KIND_ORDER: Record<AIPlatformAssetKind, number> = {
  provider_connection: 0,
  model_catalog_entry: 1,
  ai_application: 2,
  business_use_point: 3,
  route_policy: 4,
  application_binding: 5,
}

export type ReleaseStatusFilter = 'ALL' | Config['status']

export type PlatformConfigRevisionGroup = {
  key: string
  kind: AIPlatformAssetKind
  assetId: string
  records: Config[]
  drafts: Config[]
  published: Config[]
  archived: Config[]
  primary: Config
}

function newestFirst(left: Config, right: Config) {
  const byUpdatedAt = Date.parse(right.updated_at) - Date.parse(left.updated_at)
  if (Number.isFinite(byUpdatedAt) && byUpdatedAt !== 0) return byUpdatedAt
  return right.version - left.version
}

export function groupPlatformConfigRevisions(configs: Config[]): PlatformConfigRevisionGroup[] {
  const grouped = new Map<string, { kind: AIPlatformAssetKind; assetId: string; records: Config[] }>()

  for (const config of configs) {
    const kind = getAIConfigKind(config.value)
    if (!kind || !isAIPlatformAssetKind(kind)) continue
    const assetId = typeof config.value.asset_id === 'string' && config.value.asset_id.trim()
      ? config.value.asset_id.trim()
      : config.id
    const key = `${kind}:${assetId}`
    const current = grouped.get(key)
    if (current) {
      current.records.push(config)
    } else {
      grouped.set(key, { kind, assetId, records: [config] })
    }
  }

  return [...grouped.entries()].map(([key, group]) => {
    const records = [...group.records].sort(newestFirst)
    const drafts = records.filter((config) => config.status === 'DRAFT')
    const published = records.filter((config) => config.status === 'PUBLISHED')
    const archived = records.filter((config) => config.status === 'ARCHIVED')
    return {
      key,
      kind: group.kind,
      assetId: group.assetId,
      records,
      drafts,
      published,
      archived,
      // The current product fact is the published revision. A newer draft is
      // only a proposed change and must never replace what business modules
      // are consuming on the overview screens.
      primary: published[0] || drafts[0] || archived[0] || records[0],
    }
  })
}

export function orderAndFilterReleaseConfigs(
  configs: Config[],
  query: string,
  status: ReleaseStatusFilter,
) {
  const normalizedQuery = query.trim().toLowerCase()

  return configs
    .map((config, index) => ({ config, index }))
    .filter(({ config }) => status === 'ALL' || config.status === status)
    .filter(({ config }) => {
      if (!normalizedQuery) return true
      const kind = getAIConfigKind(config.value)
      const haystack = [
        config.name,
        config.key,
        typeof config.value.asset_id === 'string' ? config.value.asset_id : '',
        kind && isAIPlatformAssetKind(kind) ? AI_PLATFORM_KIND_LABELS[kind] : '',
      ].join(' ').toLowerCase()
      return haystack.includes(normalizedQuery)
    })
    .sort((left, right) => {
      const leftKind = getAIConfigKind(left.config.value)
      const rightKind = getAIConfigKind(right.config.value)
      const leftOrder = leftKind && isAIPlatformAssetKind(leftKind) ? RELEASE_KIND_ORDER[leftKind] : 99
      const rightOrder = rightKind && isAIPlatformAssetKind(rightKind) ? RELEASE_KIND_ORDER[rightKind] : 99
      if (leftOrder !== rightOrder) return leftOrder - rightOrder
      const byName = left.config.name.localeCompare(right.config.name, 'zh-CN')
      return byName || left.index - right.index
    })
    .map(({ config }) => config)
}
