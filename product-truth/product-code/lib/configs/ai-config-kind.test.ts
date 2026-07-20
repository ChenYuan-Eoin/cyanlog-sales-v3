import { describe, expect, it } from 'vitest'
import { getAIConfigKind, groupAIConfigs } from './ai-config-kind'

describe('AI config kind classification', () => {
  it('keeps provider, application, and tool policy assets in separate layers', () => {
    const configs = [
      ...Array.from({ length: 3 }, (_, index) => ({
        value: { kind: 'provider', profile: `provider-${index}`, model: `model-${index}` },
      })),
      ...Array.from({ length: 4 }, (_, index) => ({
        value: {
          kind: 'application',
          application_id: `application-${index}`,
          model: 'misleading-model-field',
        },
      })),
      ...Array.from({ length: 7 }, (_, index) => ({
        value: { kind: 'tool_policy', tool: `tool-${index}` },
      })),
    ]

    const grouped = groupAIConfigs(configs)

    expect(grouped.providers).toHaveLength(3)
    expect(grouped.applications).toHaveLength(4)
    expect(grouped.toolPolicies).toHaveLength(7)
    expect(grouped.unclassified).toHaveLength(0)
  })

  it('accepts provider-shaped legacy rows but isolates unknown or ambiguous assets', () => {
    expect(getAIConfigKind({ model: 'legacy-model', profile: 'legacy-provider' })).toBe('provider')
    expect(getAIConfigKind({ model: 'ambiguous-model' })).toBeNull()
    expect(getAIConfigKind({ kind: 'future_kind', model: 'future-model', profile: 'future' })).toBeNull()
  })

  it('keeps all six platform objects independent from legacy runtime assets', () => {
    const configs = [
      'provider_connection',
      'model_catalog_entry',
      'ai_application',
      'business_use_point',
      'application_binding',
      'route_policy',
    ].map((kind) => ({ value: { kind, schema_version: 'ai-platform.v1', asset_id: `${kind}.one` } }))

    const grouped = groupAIConfigs(configs)

    expect(grouped.providerConnections).toHaveLength(1)
    expect(grouped.modelCatalogEntries).toHaveLength(1)
    expect(grouped.aiApplications).toHaveLength(1)
    expect(grouped.businessUsePoints).toHaveLength(1)
    expect(grouped.applicationBindings).toHaveLength(1)
    expect(grouped.routePolicies).toHaveLength(1)
    expect(grouped.providers).toHaveLength(0)
    expect(grouped.unclassified).toHaveLength(0)
  })
})
