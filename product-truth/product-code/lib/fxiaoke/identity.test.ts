// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  sources: [] as Array<Record<string, unknown>>,
  mappings: [] as Array<Record<string, unknown>>,
  users: [] as Array<Record<string, unknown>>,
  memberships: [] as Array<Record<string, unknown>>,
}))

function matches(row: Record<string, unknown>, filters: Array<[string, unknown]>) {
  return filters.every(([key, value]) => row[key] === value)
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn((table: string) => {
      const filters: Array<[string, unknown]> = []
      let limit = Infinity
      const rows = () => table === 'organization_sources' ? db.sources
        : table === 'external_identities' ? db.mappings
          : table === 'users' ? db.users
            : table === 'user_organizations' ? db.memberships
              : []
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((key: string, value: unknown) => {
          filters.push([key, value])
          return query
        }),
        limit: vi.fn((value: number) => {
          limit = value
          return query
        }),
        maybeSingle: vi.fn(async () => ({
          data: rows().filter(row => matches(row, filters))[0] || null,
          error: null,
        })),
        then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
          Promise.resolve({
            data: rows().filter(row => matches(row, filters)).slice(0, limit),
            error: null,
          }).then(resolve, reject)
        ),
      }
      return query
    }),
  },
}))

import { normalizeIdentityPhone, resolveFxiaokeIdentity } from './identity'

const orgId = '00000001-0000-0000-0000-000000000000'
const otherOrgId = '99999999-9999-4999-8999-999999999999'
const userId = '22222222-2222-4222-8222-222222222222'
const otherUserId = '33333333-3333-4333-8333-333333333333'
const input = {
  orgId,
  corpId: 'FSCID_enterprise',
  externalSubject: 'employee-open-id',
  phone: '13900000000',
  employeeNumber: 'E1001',
  displayName: '测试员工',
  providerStatus: '启用',
  lifeStatus: '正常',
  loginDisabled: false,
}

function seedSource() {
  db.sources.push({
    id: 'source-1',
    system_org_id: orgId,
    provider: 'fxiaoke',
    external_tenant_id: input.corpId,
    status: 'active',
    authority_scope: { identity: 'authoritative', organization: 'evidence' },
  })
}

function seedMapping(patch: Record<string, unknown> = {}) {
  db.mappings.push({
    source_id: 'source-1',
    system_org_id: orgId,
    external_user_id: input.externalSubject,
    canonical_user_id: userId,
    match_status: 'matched',
    ...patch,
  })
}

function seedUser(id = userId, patch: Record<string, unknown> = {}) {
  db.users.push({
    id,
    org_id: orgId,
    employee_id: 'E1001',
    phone: '+8613900000000',
    status: 'active',
    login_enabled: true,
    ...patch,
  })
  db.memberships.push({ user_id: id, org_id: orgId, is_default: true, status: 'active' })
}

describe('Fxiaoke stable identity resolution', () => {
  beforeEach(() => {
    db.sources.length = 0
    db.mappings.length = 0
    db.users.length = 0
    db.memberships.length = 0
  })

  it('normalizes supported provider phones without claiming independent verification', () => {
    expect(normalizeIdentityPhone('139 0000 0000')).toBe('+8613900000000')
    expect(normalizeIdentityPhone('+852-12345678')).toBe('+85212345678')
    expect(normalizeIdentityPhone('abc')).toBeNull()
    expect(normalizeIdentityPhone(null)).toBeNull()
  })

  it('resolves only a pre-established stable mapping', async () => {
    seedSource()
    seedMapping()
    seedUser()

    await expect(resolveFxiaokeIdentity(input)).resolves.toEqual({ userId, orgId })
  })

  it('resolves the database seed organization UUID', async () => {
    seedSource()
    seedMapping()
    seedUser()
    await expect(resolveFxiaokeIdentity(input)).resolves.toEqual({ userId, orgId })
  })

  it('fails closed instead of silently binding a matching phone', async () => {
    seedSource()
    seedUser()
    await expect(resolveFxiaokeIdentity(input)).rejects.toMatchObject({
      code: 'IDENTITY_BINDING_REQUIRED',
      status: 403,
    })
  })

  it('requires an active binding source with identity authority', async () => {
    seedSource()
    db.sources[0].status = 'draft'
    seedMapping()
    seedUser()
    await expect(resolveFxiaokeIdentity(input)).rejects.toMatchObject({
      code: 'IDENTITY_SOURCE_INACTIVE',
      status: 403,
    })

    db.sources[0].status = 'active'
    db.sources[0].authority_scope = { identity: 'evidence' }
    await expect(resolveFxiaokeIdentity(input)).rejects.toMatchObject({
      code: 'IDENTITY_SOURCE_INACTIVE',
      status: 403,
    })
  })

  it('does not match a user because users.employee_id equals the external subject', async () => {
    seedSource()
    seedUser(userId, { employee_id: input.externalSubject })
    await expect(resolveFxiaokeIdentity(input)).rejects.toMatchObject({
      code: 'IDENTITY_BINDING_REQUIRED',
      status: 403,
    })
  })

  it('rejects unresolved, conflict and ignored mapping states', async () => {
    seedSource()
    seedUser()

    seedMapping({ match_status: 'unresolved', canonical_user_id: null })
    await expect(resolveFxiaokeIdentity(input)).rejects.toMatchObject({ code: 'IDENTITY_BINDING_REQUIRED', status: 403 })

    db.mappings[0] = { ...db.mappings[0], match_status: 'conflict', canonical_user_id: otherUserId }
    await expect(resolveFxiaokeIdentity(input)).rejects.toMatchObject({ code: 'IDENTITY_CONFLICT', status: 409 })

    db.mappings[0] = { ...db.mappings[0], match_status: 'ignored', canonical_user_id: null }
    await expect(resolveFxiaokeIdentity(input)).rejects.toMatchObject({ code: 'IDENTITY_DISABLED', status: 403 })
  })

  it('rejects disabled, cross-organization and ambiguous source identities', async () => {
    seedSource()
    seedMapping()
    seedUser(userId, { login_enabled: false })
    await expect(resolveFxiaokeIdentity(input)).rejects.toMatchObject({ code: 'IDENTITY_DISABLED', status: 403 })

    db.users[0].login_enabled = true
    db.users[0].org_id = otherOrgId
    await expect(resolveFxiaokeIdentity(input)).rejects.toMatchObject({ code: 'ORGANIZATION_MISMATCH', status: 403 })

    db.users[0].org_id = orgId
    db.sources.push({ ...db.sources[0], id: 'source-2', external_tenant_id: 'FSCID_other' })
    await expect(resolveFxiaokeIdentity(input)).rejects.toMatchObject({ code: 'IDENTITY_SOURCE_CONFLICT', status: 409 })
  })
})
