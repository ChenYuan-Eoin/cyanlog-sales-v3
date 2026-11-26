// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import { loadShippingModulePermissionState } from '@/lib/permission-registry'
import { readMiddlewareRpcRows } from '@/lib/middleware-rest-client'
import { requireShippingConnectionManager } from './connection-authorization'

vi.mock('@/lib/org-role-permissions', () => ({ loadCurrentOrganizationRoleAssignments: vi.fn() }))
vi.mock('@/lib/permission-registry', () => ({ loadShippingModulePermissionState: vi.fn() }))
vi.mock('@/lib/middleware-rest-client', () => ({ readMiddlewareRpcRows: vi.fn() }))

const publication = (keys: string[]) => ({ published: new Set(keys), registered: new Set(keys), departmentLedgerPublished: false })
const context = (permissions: string[], overridesEnabled = false) => ({
  orgId: 'org-a',
  settings: overridesEnabled ? { employee_permission_overrides_enabled: true } : {},
  assignments: permissions.length ? [{
    roleId: 'role-a', roleCode: 'OPERATOR', roleName: '寄件操作员', scopeType: 'org' as const, scopeId: 'org-a',
    grantedAt: null, permissions,
  }] : [],
})
const overrideRows = (rows: unknown[]) => {
  vi.mocked(readMiddlewareRpcRows).mockImplementation(async fn => fn === 'employee_permission_overrides_v1' ? rows : [
    { permission_code: 'shipping:ledger_view', base_organization_wide: false, base_department_ids: [],
      organization_wide: false, department_ids: [] },
    { permission_code: 'shipping:record_return', base_organization_wide: false, base_department_ids: [],
      organization_wide: false, department_ids: [] },
  ])
}

describe('shipping connection effective authority', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(loadShippingModulePermissionState).mockResolvedValue(publication(['shipping:operate', 'shipping:manage_connections']))
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue(context([]))
  })

  it('requires the current effective connection permission and keeps operator access distinct', async () => {
    await expect(requireShippingConnectionManager('manager')).rejects.toMatchObject({ status: 403 })
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue(context(['shipping:operate']))
    await expect(requireShippingConnectionManager('operator')).rejects.toMatchObject({ status: 403 })
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue(context(['shipping:manage_connections']))
    await expect(requireShippingConnectionManager('manager')).resolves.toBe('org-a')
  })

  it('allows a platform grant only with an exact active current org and a published definition', async () => {
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue(context(['*']))
    await expect(requireShippingConnectionManager('root')).resolves.toBe('org-a')
    vi.mocked(loadShippingModulePermissionState).mockResolvedValueOnce(publication(['shipping:operate']))
    await expect(requireShippingConnectionManager('root')).rejects.toMatchObject({ status: 403 })
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValueOnce(null)
    await expect(requireShippingConnectionManager('root')).rejects.toMatchObject({ status: 403 })
  })

  it('returns unavailable for an unreadable authorization context', async () => {
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockRejectedValueOnce(new Error('database unavailable'))
    await expect(requireShippingConnectionManager('manager')).rejects.toMatchObject({ status: 503 })
  })

  it('keeps reads and unrelated settings available after revoking one action from the legacy settings bundle', async () => {
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue(context(['shipping:manage_connections'], true))
    overrideRows([{ permission_code: 'shipping:intake_write', effect: 'DENY', scope: null }])
    await expect(requireShippingConnectionManager('staff', 'shipping:settings_view')).resolves.toBe('org-a')
    await expect(requireShippingConnectionManager('staff', 'shipping:connection_write')).resolves.toBe('org-a')
    await expect(requireShippingConnectionManager('staff', 'shipping:intake_write')).rejects.toMatchObject({ status: 403 })
    await expect(requireShippingConnectionManager('staff')).rejects.toMatchObject({ status: 403 })
  })

  it('allows an exact and published settings write only with the effective view for a role-free employee', async () => {
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue(context([], true))
    vi.mocked(loadShippingModulePermissionState).mockResolvedValue(publication(['shipping:settings_view', 'shipping:intake_write']))
    const write = { permission_code: 'shipping:intake_write', effect: 'ALLOW', scope: { type: 'org' } }
    overrideRows([write])
    await expect(requireShippingConnectionManager('staff', 'shipping:intake_write')).rejects.toMatchObject({ status: 403 })
    overrideRows([write, { permission_code: 'shipping:settings_view', effect: 'ALLOW', scope: { type: 'org' } }])
    await expect(requireShippingConnectionManager('staff', 'shipping:intake_write')).resolves.toBe('org-a')
    await expect(requireShippingConnectionManager('staff', 'shipping:connection_write')).rejects.toMatchObject({ status: 403 })
    overrideRows([write, { permission_code: 'shipping:settings_view', effect: 'DENY', scope: null }])
    await expect(requireShippingConnectionManager('staff', 'shipping:intake_write')).rejects.toMatchObject({ status: 403 })
  })
})
