// @vitest-environment node
import { NextRequest } from 'next/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POST as confirmShipment } from '@/app/api/shipping/ledger/[id]/confirm/route'
import { listShippingOperatorRecipients, loadShippingOperatorDecision, requireShippingOperator } from './operator-access'

type Row = Record<string, unknown>
const m = vi.hoisted(() => ({
  from: vi.fn(),
  requireAuth: vi.fn(),
  submitShipment: vi.fn(),
  publishedKeys: vi.fn(),
  tables: {} as Record<string, Row[]>,
  failedTable: '',
}))

vi.mock('@/lib/auth', () => ({ requireAuth: m.requireAuth, AuthError: class extends Error {} }))
vi.mock('@/lib/shipping/workflow', () => ({ confirmAndSubmitShipment: m.submitShipment }))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: m.from } }))
vi.mock('@/lib/permission-registry', () => ({
  loadPublishedModulePermissionKeys: m.publishedKeys,
  loadShippingModulePermissionState: async () => {
    const keys: string[] = await m.publishedKeys()
    return { registered: new Set(keys), published: new Set(keys) }
  },
}))

const userId = 'user-1'
const orgId = 'org-1'
const establishedRole = { id: 'shipping-role', code: 'SHIPPING_OPERATOR', name: '寄件操作员', permissions: ['shipping:operate'] }

function operatorAssignment({
  user = userId, org = orgId, role = establishedRole,
}: { user?: string; org?: string; role?: typeof establishedRole } = {}) {
  return {
    user_id: user,
    org_id: org,
    scope_type: 'org',
    scope_id: org,
    role,
    user: { id: user, status: 'active', login_enabled: true },
    membership: {
      user_id: user,
      org_id: org,
      status: 'active',
      employment_status: 'active',
      is_default: true,
      left_at: null as string | null,
      organization: { id: org, status: 'active', settings: {} as unknown },
    },
  }
}

beforeEach(() => {
  m.failedTable = ''
  m.requireAuth.mockReset().mockResolvedValue({ id: userId, org_id: orgId })
  m.submitShipment.mockReset().mockResolvedValue({ status: 'waybill_created' })
  m.publishedKeys.mockReset().mockResolvedValue(['shipping:operate'])
  m.tables = {
    user_organizations: [operatorAssignment().membership],
    organizations: [operatorAssignment().membership.organization],
    user_roles: [operatorAssignment()],
    user_permission_assignments: [{ user_id: userId, org_id: orgId, permission_point_id: 'shipping-operate' }],
  }
  m.from.mockReset().mockImplementation((table: string) => {
    const filters: Array<(row: Row) => boolean> = []
    let first = 0
    let last = Infinity
    const read = () => {
      if (m.failedTable === table) return { data: null, error: new Error('unavailable') }
      return { data: (m.tables[table] || []).filter(row => filters.every(filter => filter(row))).slice(first, last), error: null }
    }
    const builder = {
      select: vi.fn(),
      eq: (column: string, value: unknown) => {
        // Joined fields are deliberately left to production's explicit row validation.
        if (!column.includes('.')) filters.push(row => row[column] === value)
        return builder
      },
      is: () => builder,
      order: () => builder,
      range: (from: number, to: number) => { first = from; last = to + 1; return builder },
      limit: (count: number) => { last = count; return builder },
      maybeSingle: async () => {
        const result = read()
        return { ...result, data: result.data?.[0] ?? null }
      },
      then: (resolve: (value: unknown) => unknown, reject: (cause: unknown) => unknown) => Promise.resolve(read()).then(resolve, reject),
    }
    builder.select.mockReturnValue(builder)
    return builder
  })
})
afterEach(() => vi.unstubAllEnvs())

describe('organization-scoped shipping operator access', () => {
  it('reads current role authorization and honors an organization override on the next request', async () => {
    await expect(loadShippingOperatorDecision(userId)).resolves.toEqual({ orgId, canOperate: true, roleCodes: ['SHIPPING_OPERATOR'] })
    await expect(requireShippingOperator(userId)).resolves.toBe(orgId)
    m.tables.organizations[0].settings = { role_permission_overrides: { [establishedRole.id]: [] } }
    await expect(loadShippingOperatorDecision(userId)).resolves.toEqual({ orgId, canOperate: false, roleCodes: ['SHIPPING_OPERATOR'] })
    await expect(requireShippingOperator(userId)).rejects.toMatchObject({ status: 403 })
    expect(m.from).not.toHaveBeenCalledWith('user_permission_assignments')
  })

  it.each([
    { org_id: 'another-org' },
    { scope_id: 'another-org' },
    { scope_type: 'department' },
  ])('denies a role assignment outside the exact current membership scope %j', async (fields) => {
    Object.assign(m.tables.user_roles[0], fields)
    await expect(requireShippingOperator(userId)).rejects.toMatchObject({ status: 403 })
  })

  it.each([
    { status: 'inactive' },
    { employment_status: 'resigned' },
    { left_at: '2026-11-24T00:00:00Z' },
    { is_default: false },
  ])('denies a membership without active current employment %j', async fields => {
    Object.assign(m.tables.user_organizations[0], fields)
    await expect(loadShippingOperatorDecision(userId)).resolves.toBeNull()
  })

  it('keeps an enabled platform wildcard while denying a manager-only role', async () => {
    m.tables.user_roles[0].role = { id: 'root-role', code: 'SUPER_ADMIN', name: '系统超管', permissions: [] }
    await expect(requireShippingOperator(userId)).resolves.toBe(orgId)
    m.tables.user_roles[0].role = { id: 'other-role', code: 'CARRIER_MANAGER', name: '连接管理员', permissions: ['shipping:manage_connections'] }
    await expect(requireShippingOperator(userId)).rejects.toMatchObject({ status: 403 })
  })

  it('denies a missing published definition or former direct or environment grant', async () => {
    m.publishedKeys.mockResolvedValueOnce([])
    await expect(requireShippingOperator(userId)).rejects.toMatchObject({ status: 403 })
    m.tables.user_roles = []
    vi.stubEnv('SHIPPING_ALLOWED_USER_IDS', userId)
    await expect(requireShippingOperator(userId)).rejects.toMatchObject({ status: 403 })
    expect(m.from).not.toHaveBeenCalledWith('user_permission_assignments')
  })

  it('does not turn a read-only ledger grant into permission to confirm a shipment', async () => {
    m.tables.user_roles = [operatorAssignment({ role: { ...establishedRole, permissions: ['shipping:ledger_view'] } })]
    m.publishedKeys.mockResolvedValue(['shipping:ledger_view', 'shipping:order_confirm'])
    const response = await confirmShipment(new NextRequest('https://example.test/api/shipping/ledger/id/confirm', {
      method: 'POST', body: JSON.stringify({}),
    }), { params: Promise.resolve({ id: 'id' }) })
    expect(response.status).toBe(403)
    expect(m.submitShipment).not.toHaveBeenCalled()
  })

  it('enforces live grant, tenant and revocation at the actual shipment confirmation handler', async () => {
    const orderId = 'current-shipment'
    const params = { params: Promise.resolve({ id: orderId }) }
    const request = () => new NextRequest(`https://sales.example/api/shipping/ledger/${orderId}/confirm`, {
      method: 'POST', body: JSON.stringify({ serviceId: 2 }),
    })

    expect((await confirmShipment(request(), params)).status).toBe(200)
    expect(m.submitShipment).toHaveBeenCalledExactlyOnceWith(orderId, userId, orgId, { serviceId: 2 })
    m.tables.user_roles[0].org_id = 'foreign-org'
    expect((await confirmShipment(request(), params)).status).toBe(403)
    m.tables.user_roles[0].org_id = orgId
    m.tables.organizations[0].settings = { role_permission_overrides: { [establishedRole.id]: [] } }
    expect((await confirmShipment(request(), params)).status).toBe(403)
    expect(m.submitShipment).toHaveBeenCalledOnce()
  })

  it('surfaces a failure to read the current membership as unavailable', async () => {
    m.failedTable = 'user_organizations'
    await expect(requireShippingOperator(userId)).rejects.toMatchObject({ status: 503 })
  })
})

describe('shipping reminder recipients', () => {
  it('deduplicates explicit exact-org grants and excludes implicit-only platform authority', async () => {
    m.tables.user_roles.push(
      operatorAssignment({ role: { ...establishedRole, id: 'custom-role', code: 'CUSTOM', permissions: ['shipping:*'] } }),
      operatorAssignment({ user: 'tenant-b-operator', org: 'org-b' }),
      operatorAssignment({ user: 'platform-root', role: { id: 'root-role', code: 'SUPER_ADMIN', name: '平台超管', permissions: ['*'] } }),
      operatorAssignment({ user: 'connection-manager', role: { id: 'manager-role', code: 'CONNECTION_MANAGER', name: '连接管理员', permissions: ['shipping:manage_connections'] } }),
    )
    await expect(listShippingOperatorRecipients()).resolves.toEqual([
      { userId, orgId },
      { userId: 'tenant-b-operator', orgId: 'org-b' },
    ])
  })

  it('does not send to revoked, other-scope, departed, duplicate-org or disabled memberships', async () => {
    const revoked = operatorAssignment({ user: 'revoked' })
    revoked.membership.organization.settings = { role_permission_overrides: { [establishedRole.id]: [] } }
    const oldOrganization = operatorAssignment({ user: 'previous-org' })
    oldOrganization.membership.is_default = false
    const departed = operatorAssignment({ user: 'departed' })
    departed.membership.left_at = '2026-11-24T00:00:00Z'
    const disabled = operatorAssignment({ user: 'disabled' })
    disabled.user.login_enabled = false
    const stoppedOrganization = operatorAssignment({ user: 'stopped-org' })
    stoppedOrganization.membership.organization.status = 'inactive'
    const otherScope = { ...operatorAssignment({ user: 'other-scope' }), scope_id: 'unrelated-scope' }
    const wrongMembership = operatorAssignment({ user: 'unrelated-org' })
    wrongMembership.membership.org_id = 'another-organization'
    m.tables.user_roles = [revoked, oldOrganization, departed, disabled, stoppedOrganization, otherScope, wrongMembership]
    await expect(listShippingOperatorRecipients()).resolves.toEqual([])
  })

  it('stops reminders while the registry point is unavailable and never reads old grants', async () => {
    m.publishedKeys.mockResolvedValue([])
    await expect(listShippingOperatorRecipients()).resolves.toEqual([])
    expect(m.from).not.toHaveBeenCalled()
    m.publishedKeys.mockResolvedValue(['shipping:operate'])
    m.tables.user_roles = []
    await expect(listShippingOperatorRecipients()).resolves.toEqual([])
    expect(m.from).not.toHaveBeenCalledWith('user_permission_assignments')
  })

  it('includes operators beyond the first PostgREST page', async () => {
    m.tables.user_roles = Array.from({ length: 501 }, (_, index) => operatorAssignment({ user: `operator-${index}` }))
    const recipients = await listShippingOperatorRecipients()
    expect(recipients).toHaveLength(501)
    expect(recipients.at(-1)).toEqual({ userId: 'operator-500', orgId })
  })
})
