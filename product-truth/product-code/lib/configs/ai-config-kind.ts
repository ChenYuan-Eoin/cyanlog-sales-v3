import type { AIConfigKind, AIPlatformAssetKind } from './types'

export type { AIConfigKind, AIPlatformAssetKind } from './types'

export const AI_PLATFORM_ASSET_KINDS: AIPlatformAssetKind[] = [
  'provider_connection',
  'model_catalog_entry',
  'ai_application',
  'business_use_point',
  'application_binding',
  'route_policy',
]

const LEGACY_AI_CONFIG_KINDS: AIConfigKind[] = ['provider', 'application', 'tool_policy']

export function isAIPlatformAssetKind(value: unknown): value is AIPlatformAssetKind {
  return typeof value === 'string' && AI_PLATFORM_ASSET_KINDS.includes(value as AIPlatformAssetKind)
}

type AIConfigLike = {
  value: Record<string, unknown> | null | undefined
}

export function getAIConfigKind(
  value: Record<string, unknown> | null | undefined,
): AIConfigKind | null {
  if (isAIPlatformAssetKind(value?.kind)) {
    return value.kind
  }
  if (typeof value?.kind === 'string' && LEGACY_AI_CONFIG_KINDS.includes(value.kind as AIConfigKind)) {
    return value.kind as AIConfigKind
  }
  if (value?.kind !== undefined && value?.kind !== null && value?.kind !== '') {
    return null
  }

  // Historical provider rows predate kind. Accept only a real provider shape;
  // a generic AI asset with a model-like field must not enter the provider UI.
  const model = typeof value?.model === 'string' ? value.model.trim() : ''
  const hasProviderSignature = typeof value?.base_url === 'string'
    || typeof value?.provider_kind === 'string'
    || typeof value?.profile === 'string'
    || typeof value?.level === 'number'
  return model && hasProviderSignature ? 'provider' : null
}

export function groupAIConfigs<T extends AIConfigLike>(configs: T[]) {
  const providerConnections: T[] = []
  const modelCatalogEntries: T[] = []
  const aiApplications: T[] = []
  const businessUsePoints: T[] = []
  const applicationBindings: T[] = []
  const routePolicies: T[] = []
  const legacyProviders: T[] = []
  const legacyApplications: T[] = []
  const legacyToolPolicies: T[] = []
  const unclassified: T[] = []

  for (const config of configs) {
    const kind = getAIConfigKind(config.value)
    if (kind === 'provider_connection') providerConnections.push(config)
    else if (kind === 'model_catalog_entry') modelCatalogEntries.push(config)
    else if (kind === 'ai_application') aiApplications.push(config)
    else if (kind === 'business_use_point') businessUsePoints.push(config)
    else if (kind === 'application_binding') applicationBindings.push(config)
    else if (kind === 'route_policy') routePolicies.push(config)
    else if (kind === 'provider') legacyProviders.push(config)
    else if (kind === 'application') legacyApplications.push(config)
    else if (kind === 'tool_policy') legacyToolPolicies.push(config)
    else unclassified.push(config)
  }

  return {
    providerConnections,
    modelCatalogEntries,
    aiApplications,
    businessUsePoints,
    applicationBindings,
    routePolicies,
    legacyProviders,
    legacyApplications,
    legacyToolPolicies,
    // Temporary aliases keep legacy runtime/admin readers compatible while the
    // WP01 UI migrates. They never include the new six-object platform graph.
    providers: legacyProviders,
    applications: legacyApplications,
    toolPolicies: legacyToolPolicies,
    unclassified,
  }
}
