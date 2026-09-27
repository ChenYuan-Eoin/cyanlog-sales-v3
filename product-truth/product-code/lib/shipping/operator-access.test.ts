// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>
const m = vi.hoisted(() => ({
  orgId: vi.fn(), roleAssignments: vi.fn(), permissions: vi.fn(), from: vi.fn(),
  tables: {} as Record<string, Row[]>,
  writes: [] as Array<{ table: string; operation: string; value: unknown }>,
  failedTable: '',
}))

vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: m.orgId,
  getUserScopedRoleAssignments: m.roleAssignments,
  getOrgPermissions: m.permissions,
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: m.from } }))

import { importLegacyShippingOperatorAccess, listShippingOperatorRecipients, loadShippingOperatorAccess, requireShippingOperator } from './operator-access'

const userId = '11111111-1111-4111-8111-111111111111'
const pointId = 'shipping-operate'

beforeEach(() => {
  m.orgId.mockReset().mockResolvedValue('org-1')
  m.roleAssignments.mockReset().mockResolvedValue([])
  m.permissions.mockReset().mockReturnValue([])
  m.failedTable = ''
  m.writes = []
  m.tables = {
    permission_points: [{ id: pointId, code: 'shipping:operate', scope: { legacyAllowlistMigratedOrgIds: [] } }],
    users: [{ id: userId, org_id: 'org-1', display_name: '模拟成员', login_enabled: true, status: 'active' }],
    user_organizations: [{ user_id: userId, org_id: 'org-1' }],
    user_permission_assignments: [],
  }
  vi.stubEnv('SHIPPING_ALLOWED_USER_IDS', '')
  m.from.mockReset().mockImplementation((table: string) => {
    const filters: Array<(row: Row) => boolean> = []
    let operation = 'select'
    let value: Row | Row[] = {}
    const execute = () => {
      if (m.failedTable === table) return { data: null, error: new Error('database unavailable'), count: null }
      const rows = m.tables[table] || []
      if (operation !== 'select') {
        m.writes.push({ table, operation, value })
        if (operation === 'update') rows.filter(row => filters.every(filter => filter(row))).forEach(row => Object.assign(row, value))
        else if (operation === 'upsert' || operation === 'insert') rows.push(...(Array.isArray(value) ? value : [value]))
      }
      const data = rows.filter(row => filters.every(filter => filter(row)))
      return { data, error: null, count: data.length }
    }
    const builder: Record<string, unknown> = {}
    builder.select = () => builder
    builder.eq = (column: string, expected: unknown) => { filters.push(row => row[column] === expected); return builder }
    builder.in = (column: string, values: unknown[]) => { filters.push(row => values.includes(row[column])); return builder }
    builder.order = () => builder
    builder.update = (patch: Row) => { operation = 'update'; value = patch; return builder }
    builder.upsert = (records: Row | Row[]) => { operation = 'upsert'; value = records; return builder }
    builder.insert = (records: Row | Row[]) => { operation = 'insert'; value = records; return builder }
    builder.maybeSingle = async () => { const result = execute(); return { ...result, data: result.data?.[0] || null } }
    builder.single = builder.maybeSingle
    builder.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(execute()).then(resolve, reject)
    return builder
  })
})
afterEach(() => vi.unstubAllEnvs())

describe('organization-scoped shipping operator access', () => {
  it('requires an organization-scoped permission assignment', async () => {
    await expect(requireShippingOperator(userId)).rejects.toMatchObject({ status: 403 })
    m.tables.user_permission_assignments.push({ id: 'assignment-1', user_id: userId, org_id: 'org-1', permission_point_id: pointId })
    await expect(requireShippingOperator(userId)).resolves.toBe('org-1')
    m.orgId.mockResolvedValue('org-2')
    await expect(requireShippingOperator(userId)).rejects.toMatchObject({ status: 403 })
  })

  it('accepts a permission granted through an organization role', async () => {
    m.permissions.mockReturnValue(['shipping:operate'])
    await expect(requireShippingOperator(userId)).resolves.toBe('org-1')
  })

  it('never grants runtime access from the legacy allowlist, including a newly joined organization', async () => {
    vi.stubEnv('SHIPPING_ALLOWED_USER_IDS', userId)
    await expect(requireShippingOperator(userId)).rejects.toMatchObject({ status: 403 })
    m.tables.user_organizations.push({ user_id: userId, org_id: 'org-2' })
    m.orgId.mockResolvedValue('org-2')
    await expect(requireShippingOperator(userId)).rejects.toMatchObject({ status: 403 })
    expect(m.from.mock.calls.every(([table]) => table === 'permission_points' || table === 'user_permission_assignments')).toBe(true)
  })

  it('does not silently grant access when permission lookup fails', async () => {
    m.failedTable = 'permission_points'
    await expect(requireShippingOperator(userId)).rejects.toMatchObject({ status: 503 })
  })
})

describe('explicit legacy operator migration', () => {
  it('shows eligible legacy members as pending without granting runtime permission', async () => {
    vi.stubEnv('SHIPPING_ALLOWED_USER_IDS', userId)
    await expect(loadShippingOperatorAccess('org-1')).resolves.toMatchObject({
      operators: [{ id: userId, canOperate: false, grantSource: 'legacy' }],
      legacyImportAvailable: true,
      legacyImportCompleted: false,
    })
  })

  it('hides and rejects migration after a legacy user joins another organization, without writing', async () => {
    vi.stubEnv('SHIPPING_ALLOWED_USER_IDS', userId)
    m.tables.user_organizations.push({ user_id: userId, org_id: 'org-2' })
    await expect(loadShippingOperatorAccess('org-2')).resolves.toMatchObject({
      operators: [{ id: userId, canOperate: false, grantSource: 'none' }], legacyImportAvailable: false,
    })
    await expect(importLegacyShippingOperatorAccess('org-2', 'manager')).rejects.toMatchObject({ status: 403 })
    expect(m.writes).toEqual([])
  })

  it('imports a provable legacy list once and keeps retries safe after the environment variable is removed', async () => {
    vi.stubEnv('SHIPPING_ALLOWED_USER_IDS', userId)
    await expect(importLegacyShippingOperatorAccess('org-1', 'manager')).resolves.toMatchObject({
      importedCount: 1, legacyImportCompleted: true,
      operators: [{ id: userId, canOperate: true, grantSource: 'database' }],
    })
    await expect(requireShippingOperator(userId)).resolves.toBe('org-1')
    expect(m.writes[0]).toMatchObject({ table: 'user_permission_assignments', operation: 'upsert', value: [{ user_id: userId, org_id: 'org-1' }] })
    const writesAfterImport = m.writes.length
    vi.stubEnv('SHIPPING_ALLOWED_USER_IDS', '')
    await expect(importLegacyShippingOperatorAccess('org-1', 'manager')).resolves.toMatchObject({ importedCount: 0, legacyImportCompleted: true })
    expect(m.writes).toHaveLength(writesAfterImport)
  })

  it('does not restore a revoked grant when an already completed migration is retried', async () => {
    vi.stubEnv('SHIPPING_ALLOWED_USER_IDS', userId)
    m.tables.permission_points[0].scope = { legacyAllowlistMigratedOrgIds: ['org-1'] }
    await expect(importLegacyShippingOperatorAccess('org-1', 'manager')).resolves.toMatchObject({
      importedCount: 0, operators: [{ canOperate: false, grantSource: 'none' }],
    })
    expect(m.writes).toEqual([])
  })
})

describe('shipping reminder recipients', () => {
  it('does not turn legacy allowlisted users into reminder recipients', async () => {
    vi.stubEnv('SHIPPING_ALLOWED_USER_IDS', userId)
    await expect(listShippingOperatorRecipients()).resolves.toEqual([])
    expect(m.from.mock.calls.some(([table]) => table === 'user_organizations')).toBe(false)
  })

  it('returns active explicitly authorized users with their authorized organization only', async () => {
    m.tables.user_permission_assignments.push({ user_id: userId, org_id: 'org-1', permission_point_id: pointId })
    m.tables.user_organizations.push({ user_id: userId, org_id: 'org-2' })
    await expect(listShippingOperatorRecipients()).resolves.toEqual([{ userId, orgId: 'org-1' }])
    m.tables.users[0].login_enabled = false
    await expect(listShippingOperatorRecipients()).resolves.toEqual([])
  })
})
