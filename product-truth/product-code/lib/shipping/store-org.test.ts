// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoredShipping } from './store'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: mocks.from } }))
import { getOwnedShippingWaybill, shippingStoreForOrg } from './store'

type Query = { action: 'select' | 'insert' | 'update'; filters: Array<[string, unknown]>; values?: Partial<StoredShipping> }
let rows: StoredShipping[] = []
let queries: Query[] = []
let affectedWrites = 0
let reconcileRace = false

function record(id: string, orgId: string | null, changes: Partial<StoredShipping> = {}): StoredShipping {
  return { id, org_id: orgId, created_by: 'same-user', connection_key: `connection-${orgId}`, fingerprint: 'synthetic', idempotency_key: id, status: 'pending', waybill: null, created_at: '2026-09-27T00:00:00Z', environment: 'sandbox', ...changes }
}

function builder() {
  const query: Query = { action: 'select', filters: [] }
  queries.push(query)
  let requireNotAccepted = false
  let allowMissingWaybill = false
  const matches = (row: StoredShipping) => query.filters.every(([key, value]) => row[key as keyof StoredShipping] === value)
    && (!requireNotAccepted || row.status !== 'accepted' || (allowMissingWaybill && !row.waybill))
  const result = (single: boolean) => {
    if (query.action === 'insert') {
      if (rows.some(row => row.id === query.values?.id)) return { data: null, error: { code: '23505' } }
      rows.push({ ...query.values } as StoredShipping)
      affectedWrites += 1
    }
    if (query.action === 'update' && reconcileRace) {
      const row = rows.find(row => row.id === query.filters.find(([field]) => field === 'id')?.[1])
      if (row) { row.status = 'accepted'; row.waybill = 'SF1111111111111' }
    }
    const matched = query.action === 'insert' ? [rows.at(-1)!] : rows.filter(matches)
    if (query.action === 'update') matched.forEach(row => { Object.assign(row, query.values); affectedWrites += 1 })
    return { data: single ? matched[0] || null : [...matched], error: null }
  }
  const api = {
    select: () => api,
    insert: (values: StoredShipping) => { query.action = 'insert'; query.values = values; return api },
    update: (values: Partial<StoredShipping>) => { query.action = 'update'; query.values = values; return api },
    eq: (key: string, value: unknown) => { query.filters.push([key, value]); return api },
    neq: () => { requireNotAccepted = true; return api },
    or: () => { requireNotAccepted = true; allowMissingWaybill = true; return api },
    order: () => api,
    limit: () => api,
    maybeSingle: async () => result(true),
    single: async () => result(true),
    then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result(false)).then(resolve),
  }
  return api
}

beforeEach(() => {
  rows = []; queries = []; affectedWrites = 0; reconcileRace = false
  mocks.from.mockReset().mockImplementation(builder)
})

describe('provider outbox organization scope', () => {
  it('requires a trusted organization before any database access', async () => {
    expect(() => shippingStoreForOrg('')).toThrow('组织寄件授权')
    expect(() => shippingStoreForOrg('   ')).toThrow('组织寄件授权')
    await expect(getOwnedShippingWaybill('same-user', '', 'SF1234567890123')).rejects.toMatchObject({ status: 403 })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('reads only this organization and this user, including waybill ownership', async () => {
    rows = [record('A', 'org-A', { status: 'accepted', waybill: 'SF1111111111111' }), record('B', 'org-B', { status: 'accepted', waybill: 'SF2222222222222' }), record('legacy', null), record('other-user', 'org-A', { created_by: 'other-user' })]
    const store = shippingStoreForOrg('org-A')
    expect(await store.get('A', 'same-user')).toMatchObject({ id: 'A' })
    expect(await store.get('B', 'same-user')).toBeNull()
    expect(await store.get('legacy', 'same-user')).toBeNull()
    expect(await store.get('other-user', 'same-user')).toBeNull()
    expect(await store.recent('same-user')).toEqual([rows[0]])
    expect(await getOwnedShippingWaybill('same-user', 'org-A', 'SF2222222222222')).toBeNull()
    expect(await getOwnedShippingWaybill('same-user', 'org-A', 'SF1111111111111')).toMatchObject({ id: 'A' })
    expect(queries.every(query => query.filters.some(([key, value]) => key === 'org_id' && value === 'org-A'))).toBe(true)
    expect(affectedWrites).toBe(0)
  })

  it.each(['org-B', null, undefined])('rejects reserving an outbox row with org_id %s before inserting', async orgId => {
    const store = shippingStoreForOrg('org-A')
    await expect(store.reserve({ ...record('id', 'org-A'), org_id: orgId })).rejects.toMatchObject({ status: 403 })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('preserves same-organization idempotency and connection matching', async () => {
    const store = shippingStoreForOrg('org-A'), row = record('id', 'org-A')
    expect(await store.reserve(row)).toMatchObject({ inserted: true, record: { org_id: 'org-A' } })
    expect(await store.reserve(row)).toMatchObject({ inserted: false, record: { id: 'id' } })
    expect(await store.get('id', 'same-user', 'different-connection')).toBeNull()
    expect(affectedWrites).toBe(1)
  })

  it.each(['org-B', null])('does not adopt an idempotency collision belonging to %s', async orgId => {
    rows = [record('id', orgId)]
    const before = structuredClone(rows)
    await expect(shippingStoreForOrg('org-A').reserve(record('id', 'org-A'))).rejects.toMatchObject({ status: 409 })
    expect(rows).toEqual(before)
    expect(affectedWrites).toBe(0)
    expect(queries.filter(query => query.action === 'select').every(query => query.filters.some(([key, value]) => key === 'org_id' && value === 'org-A'))).toBe(true)
  })

  it.each(['org-B', null])('never sends a finish mutation for a row in %s', async orgId => {
    rows = [record('id', orgId)]
    await expect(shippingStoreForOrg('org-A').finish('id', 'same-user', 'accepted', 'SF1234567890123')).rejects.toMatchObject({ status: 404 })
    expect(queries.every(query => query.action === 'select')).toBe(true)
    expect(affectedWrites).toBe(0)
  })

  it('finishes this organization’s pending row and never downgrades it', async () => {
    rows = [record('id', 'org-A')]
    const store = shippingStoreForOrg('org-A')
    expect(await store.finish('id', 'same-user', 'accepted', 'SF1234567890123')).toMatchObject({ status: 'accepted', waybill: 'SF1234567890123' })
    expect(await store.finish('id', 'same-user', 'unknown', null)).toMatchObject({ status: 'accepted', waybill: 'SF1234567890123' })
    expect(affectedWrites).toBe(1)
    expect(queries.filter(query => query.action === 'update').every(query => query.filters.some(([key, value]) => key === 'org_id' && value === 'org-A'))).toBe(true)
  })

  it('keeps a concurrent accepted result and scopes the fallback read', async () => {
    rows = [record('id', 'org-A')]; reconcileRace = true
    expect(await shippingStoreForOrg('org-A').finish('id', 'same-user', 'unknown', null)).toMatchObject({ status: 'accepted', waybill: 'SF1111111111111' })
    expect(affectedWrites).toBe(0)
    expect(queries.at(-1)?.filters).toContainEqual(['org_id', 'org-A'])
  })
})
