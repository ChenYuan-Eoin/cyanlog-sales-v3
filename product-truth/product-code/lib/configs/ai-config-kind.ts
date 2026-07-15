export type AIConfigKind = 'provider' | 'application' | 'tool_policy'

type AIConfigLike = {
  value: Record<string, unknown> | null | undefined
}

export function getAIConfigKind(
  value: Record<string, unknown> | null | undefined,
): AIConfigKind | null {
  if (value?.kind === 'provider' || value?.kind === 'application' || value?.kind === 'tool_policy') {
    return value.kind
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
  const providers: T[] = []
  const applications: T[] = []
  const toolPolicies: T[] = []
  const unclassified: T[] = []

  for (const config of configs) {
    const kind = getAIConfigKind(config.value)
    if (kind === 'provider') providers.push(config)
    else if (kind === 'application') applications.push(config)
    else if (kind === 'tool_policy') toolPolicies.push(config)
    else unclassified.push(config)
  }

  return { providers, applications, toolPolicies, unclassified }
}
