// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decryptConnectionPayload, encryptConnectionPayload, SHARED_ENVELOPE } from './crypto'
import type { OrganizationConnectionAdapter } from './types'

const adapter = {
  provider: 'feishu',
  label: '飞书',
  previewAvailable: true,
  syncAvailable: true,
  fields: [],
  parseInput: (value: unknown) => value as Record<string, unknown>,
  prepare: () => ({ credentials: {}, metadata: {}, externalTenantId: 'tenant' }),
  verify: async () => ({ checkedAt: new Date().toISOString(), externalTenantId: 'tenant' }),
  validateStored: (value: Record<string, unknown>) => value,
} satisfies OrganizationConnectionAdapter

const context = {
  sourceId: '00000000-0000-4000-8000-000000000001',
  provider: 'feishu',
  systemOrgId: '00000000-0000-4000-8000-000000000002',
}

beforeEach(() => {
  vi.stubEnv('ORGANIZATION_CREDENTIALS_ENCRYPTION_KEY', 'ab'.repeat(32))
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('shared organization connection encryption', () => {
  it('round-trips one envelope for every provider', () => {
    const ciphertext = encryptConnectionPayload(context, { appId: 'cli_xxx', appSecret: 'secret' })
    expect(ciphertext.startsWith(`${SHARED_ENVELOPE}.`)).toBe(true)
    expect(ciphertext).not.toContain('secret')
    expect(decryptConnectionPayload(context, ciphertext, SHARED_ENVELOPE, adapter)).toEqual({
      appId: 'cli_xxx',
      appSecret: 'secret',
    })
  })

  it.each([
    ['source', { ...context, sourceId: '00000000-0000-4000-8000-000000000099' }],
    ['organization', { ...context, systemOrgId: '00000000-0000-4000-8000-000000000099' }],
    ['provider', { ...context, provider: 'fxiaoke' }],
  ])('rejects ciphertext relocated to another %s', (_label, relocated) => {
    const ciphertext = encryptConnectionPayload(context, { appSecret: 'secret' })
    expect(() => decryptConnectionPayload(relocated, ciphertext, SHARED_ENVELOPE, adapter))
      .toThrowError(expect.objectContaining({ code: 'CREDENTIALS_UNREADABLE' }))
  })

  it('fails closed when the shared key is unavailable or malformed', () => {
    vi.stubEnv('ORGANIZATION_CREDENTIALS_ENCRYPTION_KEY', 'short')
    expect(() => encryptConnectionPayload(context, { appSecret: 'secret' }))
      .toThrowError(expect.objectContaining({ code: 'ENCRYPTION_UNAVAILABLE' }))
  })
})
