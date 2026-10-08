// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const m = vi.hoisted(() => ({ from: vi.fn(), tables: {} as Record<string, Row[]>, writes: [] as Array<{ table: string; operation: string }> }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: m.from } }))
import { decryptShippingSecret, hasLegacyShippingConfiguration, importLegacyShippingConfiguration, loadShippingConfiguration, saveCarrierCredentials, type CarrierEnvironment } from './connections'

const userId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
function legacy(environment?: string): Record<string, string | undefined> {
  return {
    SF_ENVIRONMENT: environment,
    SF_PARTNER_ID: 'example-partner-id',
    SF_CHECK_WORD: 'example-check-word',
    SF_SERVICES_JSON: '[{"id":2,"name":"示例服务","preference":"standard"}]',
    SF_MONTHLY_CARD: '0000000001',
    SF_SANDBOX_MONTHLY_CARD: '0000000002',
    SHIPPING_ALLOWED_USER_IDS: userId,
    SHIPPING_SENDER_JSON: JSON.stringify({ name: '示例前台', phone: '010-55550123', province: '广东省', city: '深圳市', county: '南山区', address: '示例路8号' }),
  }
}

beforeEach(() => {
  vi.stubEnv('SHIPPING_CREDENTIALS_ENCRYPTION_KEY', '11'.repeat(32))
  m.tables = { users: [{ id: userId, org_id: orgId }], user_organizations: [{ user_id: userId, org_id: orgId }], shipping_carrier_connections: [], shipping_billing_accounts: [], shipping_sender_profiles: [] }
  m.writes = []
  m.from.mockReset().mockImplementation((table: string) => {
    if (!m.tables[table]) throw new Error('Unexpected table')
    const filters: Array<(row: Row) => boolean> = []
    let operation = 'select', value: Row = {}
    const run = () => {
      if (operation !== 'select') {
        m.writes.push({ table, operation })
        if (operation === 'update') m.tables[table].filter(row => filters.every(filter => filter(row))).forEach(row => Object.assign(row, value))
        else m.tables[table].push({ id: `${table}-${m.tables[table].length + 1}`, ...value })
        operation = 'select'
      }
      const data = m.tables[table].filter(row => filters.every(filter => filter(row)))
      return { data, error: null, count: data.length }
    }
    const query: Record<string, unknown> = {}
    query.select = () => query
    query.eq = (key: string, expected: unknown) => { filters.push(row => row[key] === expected); return query }
    query.in = (key: string, values: unknown[]) => { filters.push(row => values.includes(row[key])); return query }
    query.order = () => query
    for (const method of ['upsert', 'update', 'insert']) query[method] = (data: Row) => { operation = method; value = data; return query }
    query.maybeSingle = async () => { const result = run(); return { ...result, data: result.data[0] || null } }
    query.single = query.maybeSingle
    query.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject)
    return query
  })
})
afterEach(() => vi.unstubAllEnvs())

describe('legacy shipping environment provenance', () => {
  it.each([
    ['sandbox', 'production'], ['production', 'sandbox'], [undefined, 'production'],
    ['', 'sandbox'], ['invalid', 'production'], ['SANDBOX', 'sandbox'], [' production ', 'production'],
  ] as const)('rejects source %s for target %s before any database read or write', async (source, target) => {
    const env = legacy(source)
    expect(hasLegacyShippingConfiguration(target, { connections: [], billingAccounts: [], sender: null }, env)).toBe(false)
    await expect(importLegacyShippingConfiguration(orgId, userId, target, env)).rejects.toMatchObject({ status: 409 })
    expect(m.writes).toEqual([])
    expect(m.from).not.toHaveBeenCalled()
  })

  it('rejects a direct import independently of whether its availability was checked', async () => {
    await expect(importLegacyShippingConfiguration(orgId, userId, 'production', legacy('sandbox'))).rejects.toMatchObject({ status: 409 })
    expect(m.writes).toEqual([])
  })

  it.each(['sandbox', 'production'] as CarrierEnvironment[])('imports matching %s configuration and never overwrites it on retry', async environment => {
    const env = legacy(environment)
    expect(hasLegacyShippingConfiguration(environment, { connections: [], billingAccounts: [], sender: null }, env)).toBe(true)
    const first = await importLegacyShippingConfiguration(orgId, userId, environment, env)
    expect(first.configuration.connections).toHaveLength(1)
    expect(first.configuration.connections[0]).toMatchObject({ environment, status: 'configured' })
    expect(first.configuration.billingAccounts).toHaveLength(1)
    expect(first.configuration.billingAccounts[0]).toMatchObject({ environment, isDefault: true, status: 'active' })
    expect(first.configuration.sender?.name).toBe('示例前台')
    expect(decryptShippingSecret(String(m.tables.shipping_carrier_connections[0].credentials_ciphertext))).toBe(JSON.stringify({ partnerId: env.SF_PARTNER_ID, checkWord: env.SF_CHECK_WORD }))
    expect(JSON.stringify(first.configuration)).not.toContain(env.SF_CHECK_WORD)
    const before = structuredClone(m.tables), writeCount = m.writes.length
    const repeated = await importLegacyShippingConfiguration(orgId, userId, environment, { ...env, SF_CHECK_WORD: 'example-replacement-check-word', SF_SERVICES_JSON: '[{"id":1,"name":"另一个示例服务"}]' })
    expect(repeated.imported).toEqual([])
    expect(m.tables).toEqual(before)
    expect(m.writes).toHaveLength(writeCount)
    expect(hasLegacyShippingConfiguration(environment, repeated.configuration, env)).toBe(false)
  })

  it('preserves ordinary manually supplied connection saving without a legacy environment', async () => {
    vi.stubEnv('SF_ENVIRONMENT', '')
    await saveCarrierCredentials(orgId, userId, { partnerId: 'example-manual-partner', checkWord: 'example-manual-check-word', environment: 'production', services: [{ id: 2, name: '示例服务' }] })
    const configuration = await loadShippingConfiguration(orgId)
    expect(configuration.connections[0].environment).toBe('production')
    expect(m.writes).toEqual([{ table: 'shipping_carrier_connections', operation: 'upsert' }])
  })
})
