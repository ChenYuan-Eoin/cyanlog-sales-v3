/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
const scopedAccess = vi.hoisted(() => ({ getFreshUserScopedRoleAssignments: vi.fn() }))
const rolePermissions = vi.hoisted(() => ({ canEditRolePermissions: vi.fn() }))
vi.mock('@/lib/scoped-access', () => scopedAccess)
vi.mock('@/lib/org-role-permissions', () => rolePermissions)

import { supabaseAdmin } from '@/lib/supabase'
import {
  canManagePlatformPermissionRegistry,
  listPermissionDefinitions,
  loadPublishedPermissionCatalog,
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
    scopedAccess.getFreshUserScopedRoleAssignments.mockResolvedValue([])
    rolePermissions.canEditRolePermissions.mockReturnValue(false)
    expect(await canManagePlatformPermissionRegistry('admin-1', 'org-a')).toBe(false)

    rolePermissions.canEditRolePermissions.mockReturnValue(true)
    expect(await canManagePlatformPermissionRegistry('admin-1', 'platform-org')).toBe(true)
  })
})
