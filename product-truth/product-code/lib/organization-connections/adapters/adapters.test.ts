// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  CONFIGURABLE_PROVIDERS,
  DIRECTORY_PROVIDERS,
  PROVIDER_CATALOG,
  getDirectoryAdapter,
  getProviderAdapterCapabilities,
  hasDirectoryAdapter,
  isConfigurableProvider,
} from '.'
import { ENTERPRISE_LOGIN_PROVIDERS, getEnterpriseLoginAdapter, hasEnterpriseLoginAdapter } from './enterprise-login'
import { feishuConnectionAdapter } from './feishu'
import { fxiaokeConnectionAdapter } from './fxiaoke'

const adapterContext = { systemOrgId: '00000000-0000-4000-8000-000000000001' }

describe('provider-specific connection schemas', () => {
  it('derives configurable provider validation from the adapter registry', () => {
    expect(PROVIDER_CATALOG).toEqual([
      { key: 'fxiaoke', label: '纷享销客', unavailableReason: null },
      { key: 'feishu', label: '飞书', unavailableReason: null },
      { key: 'wecom', label: '企业微信', unavailableReason: '该组织提供方的连接器尚未接入统一配置。' },
      { key: 'dingtalk', label: '钉钉', unavailableReason: '该组织提供方的连接器尚未接入统一配置。' },
    ])
    expect(CONFIGURABLE_PROVIDERS).toEqual(['fxiaoke', 'feishu'])
    expect(isConfigurableProvider('fxiaoke')).toBe(true)
    expect(isConfigurableProvider('feishu')).toBe(true)
    expect(isConfigurableProvider('wecom')).toBe(false)
    expect(isConfigurableProvider(null)).toBe(false)
  })

  it('derives unavailable provider state from the catalogue instead of a service branch', () => {
    expect(getProviderAdapterCapabilities('wecom')).toEqual({
      credentialVerification: false,
      directoryPreview: false,
      directoryScopeProof: false,
      enterpriseLogin: false,
    })
    expect(() => getDirectoryAdapter('wecom')).toThrow('Unsupported organization directory provider')
  })

  it('keeps directory and enterprise-login capabilities in separate registries', () => {
    expect(DIRECTORY_PROVIDERS).toEqual(['fxiaoke', 'feishu'])
    expect(hasDirectoryAdapter('fxiaoke')).toBe(true)
    expect(hasDirectoryAdapter('feishu')).toBe(true)
    expect(getDirectoryAdapter('fxiaoke').provider).toBe('fxiaoke')
    expect(getProviderAdapterCapabilities('fxiaoke')).toEqual({
      credentialVerification: true,
      directoryPreview: true,
      directoryScopeProof: false,
      enterpriseLogin: true,
    })
    expect(getProviderAdapterCapabilities('feishu')).toEqual({
      credentialVerification: true,
      directoryPreview: true,
      directoryScopeProof: false,
      enterpriseLogin: false,
    })
  })

  it('derives enterprise-login capability from a separate adapter registry', () => {
    expect(ENTERPRISE_LOGIN_PROVIDERS).toEqual(['fxiaoke'])
    expect(hasEnterpriseLoginAdapter('fxiaoke')).toBe(true)
    expect(hasEnterpriseLoginAdapter('feishu')).toBe(false)
    expect(getEnterpriseLoginAdapter('fxiaoke').provider).toBe('fxiaoke')
    expect(() => getEnterpriseLoginAdapter('feishu')).toThrow('Unsupported enterprise login provider')
  })

  it('keeps Feishu limited to AppID and AppSecret while preserving a saved secret for the same app', () => {
    const first = feishuConnectionAdapter.prepare({ appId: 'cli_feishu', appSecret: 'example-feishu-secret' }, null, adapterContext)
    const next = feishuConnectionAdapter.prepare({ appId: 'cli_feishu', appSecret: '' }, first.credentials, adapterContext)

    expect(next).toMatchObject({
      externalTenantId: 'pending-feishu-cli_feishu',
      credentials: { appId: 'cli_feishu', appSecret: 'example-feishu-secret' },
    })
    expect(() => feishuConnectionAdapter.prepare({ appId: 'another-app', appSecret: '' }, first.credentials, adapterContext))
      .toThrowError(expect.objectContaining({ code: 'INVALID_CONFIGURATION' }))
  })

  it('requires Fxiaoke AppSecret and permanent code without making those fields part of Feishu', () => {
    const first = fxiaokeConnectionAdapter.prepare({
      appId: 'FSAID_xxx',
      appSecret: 'example-fxiaoke-secret',
      permanentCode: 'permanent-code',
      apiUserId: '10001',
    }, null, adapterContext)
    const next = fxiaokeConnectionAdapter.prepare({
      appId: 'FSAID_xxx',
      appSecret: '',
      permanentCode: '',
      apiUserId: '10002',
    }, first.credentials, adapterContext)

    expect(first.externalTenantId).toBe('pending-FSAID_xxx')
    expect(next.credentials).toMatchObject({
      appSecret: 'example-fxiaoke-secret',
      permanentCode: 'permanent-code',
      apiUserId: '10002',
    })
    expect(() => fxiaokeConnectionAdapter.prepare({ appId: 'other', apiUserId: '10001' }, first.credentials, adapterContext))
      .toThrowError(expect.objectContaining({ code: 'INVALID_CONFIGURATION' }))
  })

  it('keeps provider wire lifecycle values inside their adapters', () => {
    expect(['0', 'active', 'enabled'].map(value => getDirectoryAdapter('fxiaoke').normalizeDirectoryStatus(value)))
      .toEqual(['active', 'active', 'active'])
    expect(['1', 'resigned', 'frozen'].map(value => getDirectoryAdapter('fxiaoke').normalizeDirectoryStatus(value)))
      .toEqual(['inactive', 'inactive', 'inactive'])
    expect(['2', 'deleted', 'changed'].map(value => getDirectoryAdapter('fxiaoke').normalizeDirectoryStatus(value)))
      .toEqual(['deleted', 'deleted', 'unknown'])

    expect(['active', 'disabled', 'deleted', 'changed'].map(value => getDirectoryAdapter('feishu').normalizeDirectoryStatus(value)))
      .toEqual(['active', 'inactive', 'deleted', 'unknown'])
  })
})
