import { describe, expect, it } from 'vitest'
import {
  listOrganizationSourceProviders,
  OrganizationSourceError,
  selectPrimaryOrganizationSource,
  sortActiveOrganizationSources,
  type OrganizationSource,
  validateOrganizationSourceBinding,
} from './organization-sources'

function source(priority: number, overrides: Partial<OrganizationSource> = {}): OrganizationSource {
  return {
    id: `source-${priority}`,
    systemOrgId: 'org-a',
    provider: 'feishu',
    externalTenantId: `external-${priority}`,
    priority,
    status: 'active',
    authorityScope: {},
    syncMode: priority === 1 ? 'authoritative' : 'enrichment',
    lastSuccessfulSyncAt: null,
    lastError: null,
    createdAt: '2026-10-22T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
    ...overrides,
  }
}

describe('organization source priority', () => {
  it('sorts active sources by explicit priority and ignores disabled sources', () => {
    expect(sortActiveOrganizationSources([
      source(3),
      source(2),
      source(1),
      source(4, { status: 'disabled' }),
    ]).map((item) => item.priority)).toEqual([1, 2, 3])
  })

  it('requires exactly one active source with priority 1', () => {
    expect(selectPrimaryOrganizationSource([
      source(1),
      source(2),
    ])).toMatchObject({ priority: 1, syncMode: 'authoritative' })

    expect(() => selectPrimaryOrganizationSource([source(2)])).toThrowError(
      expect.objectContaining({ code: 'SOURCE_REQUIRED' }),
    )
    expect(() => selectPrimaryOrganizationSource([
      source(1, { id: 'source-a' }),
      source(1, { id: 'source-b' }),
    ])).toThrowError(
      expect.objectContaining({ code: 'SOURCE_AMBIGUOUS' }),
    )
  })

  it('exposes a typed source error', () => {
    expect(new OrganizationSourceError('SOURCE_INVALID', 'invalid')).toMatchObject({
      name: 'OrganizationSourceError',
      code: 'SOURCE_INVALID',
    })
  })
  it('marks Feishu availability from credentials and keeps unimplemented providers inactive', () => {
    expect(listOrganizationSourceProviders({})).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'feishu', syncAvailable: false }),
      expect.objectContaining({ key: 'wecom', syncAvailable: false }),
      expect.objectContaining({ key: 'dingtalk', syncAvailable: false }),
    ]))
    expect(listOrganizationSourceProviders({ FEISHU_APP_ID: 'id', FEISHU_APP_SECRET: 'secret' }))
      .toEqual(expect.arrayContaining([expect.objectContaining({ key: 'feishu', syncAvailable: true })]))
  })
  it('only allows an available provider to become active and keeps source 1 authoritative', () => {
    expect(() => validateOrganizationSourceBinding({
      provider: 'wecom',
      externalTenantId: 'tenant-1',
      priority: 1,
      status: 'active',
      syncMode: 'authoritative',
    })).toThrowError(expect.objectContaining({ code: 'SOURCE_INVALID' }))
    expect(() => validateOrganizationSourceBinding({
      provider: 'feishu',
      externalTenantId: 'tenant-1',
      priority: 1,
      status: 'active',
      syncMode: 'enrichment',
    })).toThrowError(expect.objectContaining({ code: 'SOURCE_INVALID' }))
    expect(() => validateOrganizationSourceBinding({
      provider: 'feishu',
      externalTenantId: 'tenant-1',
      priority: 2,
      status: 'active',
      syncMode: 'authoritative',
    })).toThrowError(expect.objectContaining({ code: 'SOURCE_INVALID' }))
  })
})

