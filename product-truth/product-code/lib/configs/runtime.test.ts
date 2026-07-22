import { describe, expect, it } from 'vitest'
import {
  mergeStoredAIConfigValue,
  resolveRuntimeModel,
  splitPublishedAIConfigs,
  type ConfigRow,
} from './runtime'

function configRow(
  key: string,
  value: Record<string, unknown>,
  updatedAt = '2026-07-13T00:00:00.000Z'
): ConfigRow {
  return {
    id: `${key}-id`,
    key,
    name: key,
    value,
    type: 'AI_CONFIG',
    status: 'PUBLISHED',
    org_id: 'org-1',
    updated_at: updatedAt,
  }
}

describe('resolveRuntimeModel', () => {
  it('keeps an explicit model as the runtime model', () => {
    expect(resolveRuntimeModel({
      model: 'gpt-4o',
      model_mappings: [
        { role: 'default', request_model: 'gpt-oss-20b', enabled: true },
      ],
    })).toBe('gpt-4o')
  })

  it('uses the enabled default mapping when model is blank', () => {
    expect(resolveRuntimeModel({
      model: '',
      model_mappings: [
        { role: 'sonnet', request_model: 'claude-sonnet-4', enabled: true },
        { role: 'default', request_model: 'gpt-oss-20b', enabled: true },
      ],
    })).toBe('gpt-oss-20b')
  })

  it('skips disabled mappings and falls back to the first enabled request model', () => {
    expect(resolveRuntimeModel({
      model_mappings: [
        { role: 'default', request_model: 'disabled-model', enabled: false },
        { role: 'opus', request_model: 'claude-opus-4-8', enabled: true },
      ],
    })).toBe('claude-opus-4-8')
  })
})

describe('mergeStoredAIConfigValue', () => {
  it('keeps the stored api key when the editor submits a masked value', () => {
    expect(mergeStoredAIConfigValue(
      { api_key: 'sk-real-token', model: 'old-model' },
      { api_key: 'sk-***oken', model: 'new-model' }
    )).toEqual({
      api_key: 'sk-real-token',
      model: 'new-model',
    })
  })

  it('uses the new api key when the editor provides an unmasked token', () => {
    expect(mergeStoredAIConfigValue(
      { api_key: 'sk-old-token' },
      { api_key: 'sk-new-token' }
    )).toEqual({
      api_key: 'sk-new-token',
    })
  })
})

describe('splitPublishedAIConfigs', () => {
  it('keeps legacy records as providers while separating applications and tool policies', () => {
    const bundle = splitPublishedAIConfigs([
      configRow('legacy_local', {
        level: 2,
        name: 'Local model',
        base_url: 'http://127.0.0.1:1234/v1',
        model: 'gpt-oss-20b',
        timeout_ms: 45_000,
        enabled: true,
      }),
      configRow('contract_review_agent', {
        kind: 'application',
        name: 'Contract review agent',
        enabled: true,
        bound_tools: ['contract_review'],
        capabilities: ['contract_review'],
      }),
      configRow('contract_review_local_first', {
        kind: 'tool_policy',
        name: 'Contract review local first',
        enabled: true,
        tool: 'contract_review',
        capability: 'contract_review',
        strategy: 'local_first',
        priority: 10,
        provider_chain: ['legacy_local'],
        fallback_chain: ['rule_engine'],
        timeout_ms: 30_000,
      }),
    ])

    expect(bundle.providers.map((entry) => entry.key)).toEqual(['legacy_local'])
    expect(bundle.providers.map((entry) => entry.instance_id)).toEqual(['legacy_local'])
    expect(bundle.applications.map((entry) => entry.key)).toEqual(['contract_review_agent'])
    expect(bundle.toolPolicies.map((entry) => entry.key)).toEqual(['contract_review_local_first'])
    expect(bundle.hasPublishedConfigs).toBe(true)
    expect(bundle.hasStructuredConfigs).toBe(true)
  })

  it('separates the stable provider instance id from a legacy L1/L2/L3 config key', () => {
    const bundle = splitPublishedAIConfigs([
      configRow('AI_LEVEL_1', {
        kind: 'provider',
        level: 1,
        name: 'Local model',
        instance_id: 'local_primary',
        profile: 'local_primary',
        base_url: 'http://127.0.0.1:1234/v1',
        model: 'gpt-oss-20b',
        timeout_ms: 45_000,
        enabled: true,
      }),
    ])

    expect(bundle.providers[0]).toMatchObject({
      key: 'AI_LEVEL_1',
      instance_id: 'local_primary',
      profile: 'local_primary',
    })
  })

  it('sorts tool policies by explicit priority and excludes disabled structured records', () => {
    const bundle = splitPublishedAIConfigs([
      configRow('late', {
        kind: 'tool_policy',
        name: 'Late policy',
        enabled: true,
        tool: 'contract_review',
        capability: 'contract_review',
        strategy: 'quality_first',
        priority: 200,
        provider_chain: ['cloud'],
        timeout_ms: 30_000,
      }),
      configRow('early', {
        kind: 'tool_policy',
        name: 'Early policy',
        enabled: true,
        tool: 'contract_review',
        capability: 'contract_review',
        strategy: 'local_first',
        priority: 10,
        provider_chain: ['local'],
        timeout_ms: 30_000,
      }),
      configRow('disabled_application', {
        kind: 'application',
        name: 'Disabled app',
        enabled: false,
      }),
    ])

    expect(bundle.toolPolicies.map((entry) => entry.key)).toEqual(['early', 'late'])
    expect(bundle.applications).toEqual([])
  })
})
