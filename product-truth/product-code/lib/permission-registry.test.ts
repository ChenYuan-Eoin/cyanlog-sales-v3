/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
const rolePermissions = vi.hoisted(() => ({ loadOrgRolePermissionContext: vi.fn() }))
vi.mock('@/lib/org-role-permissions', () => rolePermissions)

import { supabaseAdmin } from '@/lib/supabase'
import {
  canManagePlatformPermissionRegistry,
  listPermissionDefinitions,
  loadPublishedPermissionCatalog,
  loadPublishedModulePermissionKeys,
  loadRoleModulePermissionCatalog,
} from './permission-registry'

const originalAdminOrgId = process.env.PERMISSION_REGISTRY_ADMIN_ORG_ID

describe('permission registry repository', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    delete process.env.PERMISSION_REGISTRY_ADMIN_ORG_ID
  })

  afterEach(() => {
    if (originalAdminOrgId === undefined) {
      delete process.env.PERMISSION_REGISTRY_ADMIN_ORG_ID
    } else {
      process.env.PERMISSION_REGISTRY_ADMIN_ORG_ID = originalAdminOrgId
    }
  })

  it('falls back to the executable built-in registry when the additive migration is not present', async () => {
    const resultPromise = Promise.resolve({ data: null, error: new Error('missing column') })
    const query: any = {
      select: vi.fn(() => query),
      eq: vi.fn(() => query),
      order: vi.fn(() => query),
      then: resultPromise.then.bind(resultPromise),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(query as any)

    const result = await listPermissionDefinitions()
    expect(result.source).toBe('builtin')
    expect(result.definitions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'role:manage', status: 'published' }),
    ]))
  })

  it('returns unavailable definitions to the role UI so existing legacy grants can be explained and cleared', async () => {
    const resultPromise = Promise.resolve({
        data: [{
          id: 'permission-1',
          code: 'report:finance',
          name: '财务报表访问',
          description: 'reserved',
          resource: 'report',
          action: 'finance',
          kind: 'atomic',
          status: 'draft',
          category: 'console',
          semantic_version: '1.0.0',
          lifecycle_version: 1,
          supported_scope_types: ['org'],
          dependencies: [],
          conflicts: [],
          implied_by: [],
          enforcement_consumer: null,
        }],
        error: null,
      })
    const query: any = {
      select: vi.fn(() => query),
      order: vi.fn(() => query),
      then: resultPromise.then.bind(resultPromise),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(query as any)

    const result = await loadPublishedPermissionCatalog()
    expect(result.source).toBe('database')
    expect(result.catalog.flatMap((group) => group.items)).toContainEqual(
      expect.objectContaining({
        key: 'report:finance',
        selectable: false,
        unavailableReason: expect.stringContaining('尚未接入'),
      }),
    )
  })

  it('requires both the configured platform organization and a fresh platform root administrator', async () => {
    expect(await canManagePlatformPermissionRegistry('admin-1', 'org-a')).toBe(false)

    process.env.PERMISSION_REGISTRY_ADMIN_ORG_ID = 'platform-org'
    expect(await canManagePlatformPermissionRegistry('admin-1', 'org-a')).toBe(false)
    expect(rolePermissions.loadOrgRolePermissionContext).not.toHaveBeenCalled()

    rolePermissions.loadOrgRolePermissionContext.mockResolvedValue({ orgId: 'platform-org', canEdit: true, canEditPlatformRoot: false })
    expect(await canManagePlatformPermissionRegistry('org-admin', 'platform-org')).toBe(false)
    rolePermissions.loadOrgRolePermissionContext.mockResolvedValue({ orgId: 'org-a', canEdit: true, canEditPlatformRoot: true })
    expect(await canManagePlatformPermissionRegistry('admin-1', 'platform-org')).toBe(false)
    rolePermissions.loadOrgRolePermissionContext.mockResolvedValue({ orgId: 'platform-org', canEdit: true, canEditPlatformRoot: true })
    expect(await canManagePlatformPermissionRegistry('admin-1', 'platform-org')).toBe(true)
  })
})

describe('shipping permissions from the executable registry', () => {
  const operate = {
    id: 'shipping-op-id', code: 'shipping:operate', name: '寄件操作', description: '当前组织寄件操作',
    resource: 'shipping', action: 'operate', kind: 'atomic', status: 'published', category: 'shipping',
    semantic_version: '1.0.0', lifecycle_version: 2, supported_scope_types: ['org'], dependencies: [],
    conflicts: [], implied_by: [], enforcement_consumer: 'lib/shipping/operator-access.ts#requireShippingOperator',
  }
  const connections = {
    ...operate, id: 'shipping-con-id', code: 'shipping:manage_connections', name: '寄件连接管理',
    action: 'manage_connections', enforcement_consumer: 'lib/shipping/connection-authorization.ts',
  }
  function permissionQuery(data: unknown, error: unknown = null) {
    const query = {
      select: vi.fn(() => query),
      in: vi.fn(async () => ({ data, error })),
    }
    vi.mocked(supabaseAdmin.from).mockReturnValue(query as any)
    return query
  }

  it('selects just the exact shipping definitions and returns installed labels', async () => {
    const query = permissionQuery([operate, connections])
    const keys = await loadPublishedModulePermissionKeys()
    expect(keys).toEqual(['shipping:manage_connections', 'shipping:operate'])
    expect((await loadRoleModulePermissionCatalog()).flatMap(group => group.items).map(item => item.key).sort()).toEqual(keys)
    expect(query.in).toHaveBeenCalledWith('code', ['shipping:operate', 'shipping:manage_connections'])
  })

  it('returns no executable actions for a stale, unverified or failed registry', async () => {
    permissionQuery([{ ...operate, supported_scope_types: ['org', 'department'] }, { ...connections, status: 'disabled' }])
    expect(await loadPublishedModulePermissionKeys()).toEqual([])
    expect(await loadRoleModulePermissionCatalog()).toEqual([])
    permissionQuery([operate, connections], new Error('database unavailable'))
    expect(await loadPublishedModulePermissionKeys()).toEqual([])
    expect(await loadRoleModulePermissionCatalog()).toEqual([])
  })
})
