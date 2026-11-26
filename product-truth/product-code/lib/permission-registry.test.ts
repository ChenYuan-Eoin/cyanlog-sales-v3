/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn() } }))
const rolePermissions = vi.hoisted(() => ({ loadOrgRolePermissionContext: vi.fn() }))
vi.mock('@/lib/org-role-permissions', () => rolePermissions)

import { supabaseAdmin } from '@/lib/supabase'
import { REGISTERED_MODULE_PERMISSION_KEYS } from './module-access'
import {
  canManagePlatformPermissionRegistry,
  createPermissionDefinition,
  listPermissionDefinitions,
  loadPublishedPermissionCatalog,
  loadPublishedModulePermissionKeys,
  loadRoleModulePermissionCatalog,
  loadRoleModulePermissionProjection,
  ROLE_PERMISSION_PROJECTION_KEYS,
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
        moduleKey: null,
        capabilityLevel: null,
        grantSubjectTypes: [],
        selectable: false,
        unavailableReason: expect.stringContaining('尚未接入'),
      }),
    )
  })

  it('rejects unknown metadata level or receiver types before writing a definition', async () => {
    await expect(createPermissionDefinition('actor', {
      moduleKey: 'shipping', capabilityLevel: 'L5', grantSubjectTypes: ['role'],
    })).rejects.toMatchObject({ code: 'INVALID' })
    await expect(createPermissionDefinition('actor', {
      moduleKey: 'shipping', capabilityLevel: 'L3', grantSubjectTypes: ['member'],
    })).rejects.toMatchObject({ code: 'INVALID' })
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('round-trips draft dictionary metadata through the registry and audit snapshot', async () => {
    const existing = {
      id: 'existing-id', code: 'config:read', name: '配置中心查看', description: '查看配置',
      category: 'console', status: 'published',
    }
    const draft = {
      id: 'draft-id', code: 'demo:read', name: '查看样本', description: '演示定义',
      category: 'org', status: 'draft', module_key: 'config', capability_level: 'L3', grant_subject_types: ['role'],
    }
    const existingResult = Promise.resolve({ data: [existing], error: null })
    const listQuery = {
      select: vi.fn(() => listQuery),
      order: vi.fn(() => listQuery),
      then: existingResult.then.bind(existingResult),
    }
    const createQuery = {
      insert: vi.fn(() => createQuery),
      select: vi.fn(() => createQuery),
      single: vi.fn(async () => ({ data: draft, error: null })),
    }
    const auditQuery = { insert: vi.fn(async () => ({ error: null })) }
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(listQuery as any)
      .mockReturnValueOnce(createQuery as any).mockReturnValueOnce(auditQuery as any)

    const metadata = { moduleKey: 'config', capabilityLevel: 'L3', grantSubjectTypes: ['role'] }
    await expect(createPermissionDefinition('actor', {
      key: 'demo:read', label: '查看样本', description: '演示定义', category: 'org', ...metadata,
    })).resolves.toMatchObject({ ...metadata, status: 'draft' })
    expect(createQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      module_key: 'config', capability_level: 'L3', grant_subject_types: ['role'],
    }))
    expect(auditQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
      after_snapshot: expect.objectContaining(metadata),
    }))
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
    expect(query.in).toHaveBeenCalledWith('code', [...REGISTERED_MODULE_PERMISSION_KEYS])
  })

  it('returns no executable actions for a stale, unverified or failed registry', async () => {
    permissionQuery([{ ...operate, supported_scope_types: ['org', 'department'] }, { ...connections, status: 'disabled' }])
    expect(await loadPublishedModulePermissionKeys()).toEqual([])
    expect(await loadRoleModulePermissionCatalog()).toEqual([])
    permissionQuery([operate, connections], new Error('database unavailable'))
    expect(await loadPublishedModulePermissionKeys()).toEqual([])
    expect(await loadRoleModulePermissionCatalog()).toEqual([])
  })

  it('reads dictionary metadata without using it to publish shipping permissions', async () => {
    const ledger = {
      ...operate, id: 'ledger-id', code: 'shipping:ledger_view', action: 'ledger_view',
      enforcement_consumer: 'lib/shipping/http.ts', supported_scope_types: ['org', 'department'],
      module_key: 'shipping', capability_level: 'L3', grant_subject_types: ['role', 'department'],
    }
    const recordReturn = {
      ...ledger, id: 'return-id', code: 'shipping:record_return', action: 'record_return',
      dependencies: ['shipping:ledger_view'], grant_subject_types: ['role'],
    }
    permissionQuery([ledger, { ...recordReturn, status: 'disabled' }])
    const catalog = await loadRoleModulePermissionCatalog()
    expect(catalog.flatMap(group => group.items)).toEqual([
      expect.objectContaining({
        key: 'shipping:ledger_view', moduleKey: 'shipping', capabilityLevel: 'L3',
        grantSubjectTypes: ['role', 'department'],
      }),
    ])
    permissionQuery([ledger, recordReturn])
    expect((await loadRoleModulePermissionCatalog()).flatMap(group => group.items))
      .toContainEqual(expect.objectContaining({
        key: 'shipping:record_return', scopeTypes: ['org', 'department'], grantSubjectTypes: ['role'],
      }))
  })

  it('projects mapped configuration rows without including them in shipping publication', async () => {
    const config = {
      ...operate, id: 'config-id', code: 'config:publish', resource: 'config', action: 'publish', category: 'console',
      enforcement_consumer: 'lib/configs/access.ts', module_key: 'config', capability_level: 'L4', grant_subject_types: ['role'],
    }
    const managedRole = {
      ...config, id: 'role-id', code: 'role:manage', resource: 'role', action: 'manage', grant_subject_types: [],
    }
    const unregistered = { ...config, id: 'quote-id', code: 'quote:view' }
    const query = permissionQuery([operate, config, managedRole, unregistered])
    const { publication, catalog } = await loadRoleModulePermissionProjection()
    expect(query.in).toHaveBeenCalledWith('code', ROLE_PERMISSION_PROJECTION_KEYS)
    expect(publication.registered).toEqual(new Set(['shipping:operate']))
    expect(publication.published).toEqual(new Set(['shipping:operate']))
    expect(catalog.flatMap(group => group.items)).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'config:publish', moduleKey: 'config', capabilityLevel: 'L4', selectable: true }),
      expect.objectContaining({ key: 'role:manage', moduleKey: 'config', grantSubjectTypes: [], selectable: false }),
    ]))
    expect(catalog.flatMap(group => group.items).map(item => item.key)).not.toContain('quote:view')
  })
})
