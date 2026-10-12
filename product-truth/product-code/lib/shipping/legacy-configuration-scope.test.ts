// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  filters: [] as Array<{ table: string; column: string; values: string[] }>,
  users: [] as Array<{ id: string; org_id: string | null }>,
  memberships: [] as Array<{ user_id: string; org_id: string }>,
  failedTable: '',
  truncatedTable: '',
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))

import { canImportLegacyShippingConfiguration } from './legacy-configuration-scope'

const userA = '11111111-1111-4111-8111-111111111111'
const userB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const env = { SHIPPING_ALLOWED_USER_IDS: `${userA},${userB}` }

beforeEach(() => {
  mocks.users = [{ id: userA, org_id: 'org-a' }, { id: userB, org_id: 'org-a' }]
  mocks.memberships = [{ user_id: userA, org_id: 'org-a' }, { user_id: userB, org_id: 'org-a' }]
  mocks.failedTable = ''
  mocks.truncatedTable = ''
  mocks.filters = []
  mocks.select.mockClear()
  mocks.from.mockReset().mockImplementation((table: string) => ({
    select: (...args: unknown[]) => {
      mocks.select(...args)
      return {
        in: async (column: string, values: string[]) => {
          mocks.filters.push({ table, column, values })
          const data = table === 'users' ? mocks.users : mocks.memberships
          return {
            data,
            count: data.length + (mocks.truncatedTable === table ? 1 : 0),
            error: mocks.failedTable === table ? { message: 'private database error' } : null,
          }
        },
      }
    },
  }))
})

describe('legacy shipping configuration organization provenance', () => {
  it('checks real organization provenance for legacy seeded PostgreSQL UUIDs', async () => {
    const seeded = '30000001-0000-0000-0000-000000000000'
    mocks.users = [{ id: seeded, org_id: 'org-a' }]
    mocks.memberships = [{ user_id: seeded, org_id: 'org-a' }]
    const legacy = { SHIPPING_ALLOWED_USER_IDS: seeded }
    await expect(canImportLegacyShippingConfiguration('org-a', legacy)).resolves.toBe(true)
    await expect(canImportLegacyShippingConfiguration('org-b', legacy)).resolves.toBe(false)
    mocks.memberships.push({ user_id: seeded, org_id: 'org-b' })
    await expect(canImportLegacyShippingConfiguration('org-a', legacy)).resolves.toBe(false)
  })

  it('allows the uniquely shared organization and rejects another organization', async () => {
    await expect(canImportLegacyShippingConfiguration('org-a', env)).resolves.toBe(true)
    await expect(canImportLegacyShippingConfiguration('org-b', env)).resolves.toBe(false)
    expect(mocks.select).toHaveBeenCalledWith('id,org_id', { count: 'exact' })
    expect(mocks.select).toHaveBeenCalledWith('user_id,org_id', { count: 'exact' })
    expect(mocks.filters[0]).toEqual({ table: 'users', column: 'id', values: [userA, userB] })
    expect(mocks.filters[1]).toEqual({ table: 'user_organizations', column: 'user_id', values: [userA, userB] })
  })

  it.each(['primary', 'membership', 'different users'])('rejects conflicting %s organizations', async (source) => {
    if (source === 'primary') mocks.users[0].org_id = 'org-b'
    if (source === 'membership') mocks.memberships.push({ user_id: userA, org_id: 'org-b' })
    if (source === 'different users') {
      mocks.users[1].org_id = 'org-b'
      mocks.memberships[1].org_id = 'org-b'
    }
    await expect(canImportLegacyShippingConfiguration('org-a', env)).resolves.toBe(false)
    await expect(canImportLegacyShippingConfiguration('org-b', env)).resolves.toBe(false)
  })

  it('requires every listed user to exist, even if a membership row remains', async () => {
    mocks.users.pop()
    await expect(canImportLegacyShippingConfiguration('org-a', env)).resolves.toBe(false)
  })

  it('rejects a user with no provable organization', async () => {
    mocks.users[1].org_id = null
    mocks.memberships.pop()
    await expect(canImportLegacyShippingConfiguration('org-a', env)).resolves.toBe(false)
  })

  it('accepts a unique recorded membership when primary organization is unset', async () => {
    mocks.users[1].org_id = null
    await expect(canImportLegacyShippingConfiguration('org-a', env)).resolves.toBe(true)
  })

  it.each(['', ' , ', 'invalid-user', `${userA},invalid-user`])('rejects missing or malformed allowlist %s without querying', async (allowlist) => {
    await expect(canImportLegacyShippingConfiguration('org-a', { SHIPPING_ALLOWED_USER_IDS: allowlist })).resolves.toBe(false)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('normalizes UUID case and deduplicates the established allowlist', async () => {
    await expect(canImportLegacyShippingConfiguration('org-a', { SHIPPING_ALLOWED_USER_IDS: ` ${userA},${userB.toUpperCase()},${userB}` })).resolves.toBe(true)
    expect(mocks.filters[0].values).toEqual([userA, userB])
  })

  it.each(['users', 'user_organizations'])('rejects truncated %s results', async (table) => {
    mocks.truncatedTable = table
    await expect(canImportLegacyShippingConfiguration('org-a', env)).resolves.toBe(false)
  })

  it.each(['users', 'user_organizations'])('reports failed %s lookup as a safe service error', async (table) => {
    mocks.failedTable = table
    await expect(canImportLegacyShippingConfiguration('org-a', env)).rejects.toMatchObject({
      status: 503,
      message: '旧寄件配置所属组织核验失败，请稍后重试。',
    })
  })

  it('reports thrown database failures as 503 without exposing their details', async () => {
    mocks.from.mockImplementation(() => { throw new Error('private transport error') })
    await expect(canImportLegacyShippingConfiguration('org-a', env)).rejects.toMatchObject({
      status: 503,
      message: '旧寄件配置所属组织核验失败，请稍后重试。',
    })
  })
})
