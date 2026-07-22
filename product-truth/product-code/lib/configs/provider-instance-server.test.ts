import { describe, expect, it } from 'vitest'
import { findDuplicateAIProviderInstanceInRows } from './provider-instance-server'

describe('findDuplicateAIProviderInstanceInRows', () => {
  it('uses the stable instance id instead of the config object key', () => {
    const duplicate = findDuplicateAIProviderInstanceInRows([
      {
        id: 'provider-1',
        key: 'AI_LEVEL_1',
        value: {
          kind: 'provider',
          instance_id: 'local_primary',
          profile: 'legacy_local',
        },
      },
    ], 'local_primary')

    expect(duplicate?.key).toBe('AI_LEVEL_1')
    expect(findDuplicateAIProviderInstanceInRows([
      {
        id: 'provider-1',
        key: 'AI_LEVEL_1',
        value: { kind: 'provider', instance_id: 'local_primary' },
      },
    ], 'AI_LEVEL_1')).toBeNull()
  })

  it('ignores model applications and tool policies', () => {
    expect(findDuplicateAIProviderInstanceInRows([
      {
        id: 'application-1',
        key: 'contract_review_agent',
        value: { kind: 'application', instance_id: 'local_primary' },
      },
      {
        id: 'policy-1',
        key: 'contract_review_local_first',
        value: { kind: 'tool_policy', instance_id: 'local_primary' },
      },
    ], 'local_primary')).toBeNull()
  })

  it('keeps legacy provider profiles addressable during migration', () => {
    expect(findDuplicateAIProviderInstanceInRows([
      {
        id: 'provider-legacy',
        key: 'AI_LEVEL_2',
        value: { kind: 'provider', profile: 'sales_cloud_backup' },
      },
    ], 'sales_cloud_backup')?.id).toBe('provider-legacy')
  })
})
