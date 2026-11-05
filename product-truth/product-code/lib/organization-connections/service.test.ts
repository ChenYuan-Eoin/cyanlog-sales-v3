import { describe, expect, it } from 'vitest'
import {
  hasIdentityAuthority,
  listOrganizationConnectionProviders,
  mapLegacyFxiaokeConnectionRow,
  toConnectionSummary,
} from './service'

const legacySource = {
  id: '00000000-0000-4000-8000-000000000001',
  system_org_id: '00000000-0000-4000-8000-000000000002',
  provider: 'fxiaoke' as const,
  external_tenant_id: 'FSCID_company',
  priority: 100,
  status: 'active' as const,
  authority_scope: { identity: 'authoritative', organization: 'evidence' },
  sync_mode: 'enrichment' as const,
  last_successful_sync_at: null,
  last_error: null,
  created_at: '2026-11-01T00:00:00.000Z',
  updated_at: '2026-11-02T00:00:00.000Z',
}

const legacyConnection = {
  system_org_id: legacySource.system_org_id,
  app_id: 'FSAID_example',
  expected_ea: legacySource.external_tenant_id,
  api_user_id: '1093',
  credentials_ciphertext: 'v1.fixture',
  revision: '00000000-0000-4000-8000-000000000003',
  last_checked_at: '2026-11-03T00:00:00.000Z',
  last_check_status: 'preview_ready' as const,
  last_error: null,
  preview_started_at: '2026-11-03T00:00:00.000Z',
  updated_by: null,
  updated_at: '2026-11-03T00:00:00.000Z',
}

describe('identity authority capability', () => {
  it('does not infer enterprise login authority from directory or organization authority', () => {
    expect(hasIdentityAuthority({ directory: 'authoritative', organization: 'authoritative' })).toBe(false)
    expect(hasIdentityAuthority({ identity: 'evidence', directory: 'authoritative' })).toBe(false)
    expect(hasIdentityAuthority({ identity: 'authoritative' })).toBe(true)
  })

  it('does not infer enterprise login from configurable directory support', () => {
    const providers = listOrganizationConnectionProviders()
    expect(providers.find(provider => provider.key === 'fxiaoke')).toMatchObject({
      configurable: true,
      previewAvailable: true,
      syncAvailable: true,
      ssoAvailable: true,
      capabilities: {
        credentialVerification: true,
        directoryPreview: true,
        directoryScopeProof: false,
        enterpriseLogin: true,
      },
    })
    expect(providers.find(provider => provider.key === 'feishu')).toMatchObject({
      configurable: true,
      previewAvailable: true,
      syncAvailable: true,
      ssoAvailable: false,
      capabilities: {
        credentialVerification: true,
        directoryPreview: true,
        directoryScopeProof: false,
        enterpriseLogin: false,
      },
    })
  })

  it('builds the full provider catalogue without provider-name branches in the service', () => {
    expect(listOrganizationConnectionProviders()).toMatchObject([
      { key: 'fxiaoke', label: '纷享销客', configurable: true, unavailableReason: null },
      { key: 'feishu', label: '飞书', configurable: true, unavailableReason: null },
      {
        key: 'wecom',
        label: '企业微信',
        configurable: false,
        unavailableReason: '该组织提供方的连接器尚未接入统一配置。',
      },
      {
        key: 'dingtalk',
        label: '钉钉',
        configurable: false,
        unavailableReason: '该组织提供方的连接器尚未接入统一配置。',
      },
    ])
  })
})

describe('legacy Fxiaoke compatibility projection', () => {
  it('presents an existing verified connection through the shared read model without writing', () => {
    const row = mapLegacyFxiaokeConnectionRow(legacySource, legacyConnection)
    expect(toConnectionSummary(row)).toMatchObject({
      sourceId: legacySource.id,
      provider: 'fxiaoke',
      revision: legacyConnection.revision,
      state: 'verified',
      draftCheckStatus: 'preview_ready',
      configured: true,
      effectiveVerified: true,
      metadata: { appId: 'FSAID_example', apiUserId: '1093', expectedEa: 'FSCID_company' },
      storageMode: 'legacy_fxiaoke_read_only',
    })
  })

  it.each(['active', 'disabled'] as const)('exposes an EA/corpId legacy connection as unverified and preserves %s state', status => {
    const row = mapLegacyFxiaokeConnectionRow({ ...legacySource, status }, { ...legacyConnection, expected_ea: 'ones001' })
    expect(toConnectionSummary(row)).toMatchObject({
      externalTenantId: 'FSCID_company', configured: true, effectiveVerified: false,
      draftCheckStatus: 'not_checked', state: status === 'disabled' ? 'disabled' : 'configured',
      metadata: { expectedEa: 'ones001' },
    })
    expect(row.effective_credentials_ciphertext).toBeNull()
  })

  it('rejects a legacy connection from another system organization even with matching external identifiers', () => {
    expect(() => mapLegacyFxiaokeConnectionRow(legacySource, { ...legacyConnection, system_org_id: 'foreign-org' }))
      .toThrowError(expect.objectContaining({ code: 'CONNECTION_AMBIGUOUS' }))
  })

  it('fails closed when the legacy record belongs to another enterprise', () => {
    expect(() => mapLegacyFxiaokeConnectionRow(legacySource, {
      ...legacyConnection,
      expected_ea: 'FSCID_other',
    })).toThrowError(expect.objectContaining({ code: 'CONNECTION_AMBIGUOUS', status: 409 }))
  })
})
