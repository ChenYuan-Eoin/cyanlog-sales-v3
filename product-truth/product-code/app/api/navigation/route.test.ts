import { NextRequest } from 'next/server'
import { beforeEach, expect, it, vi } from 'vitest'
import { AuthError, requireAuth } from '@/lib/auth'
import { ORGANIZATION_ACTIONS_HEADER, resolveOrganizationPermissionDecision } from '@/lib/admin/organization-permission-decision'
import { resolveShippingEntry } from '@/lib/shipping/entry-access'
import { GET } from './route'

vi.mock('@/lib/auth', async original => ({ ...await original<typeof import('@/lib/auth')>(), requireAuth: vi.fn() }))
vi.mock('@/lib/shipping/entry-access', () => ({ resolveShippingEntry: vi.fn() }))

const user = { id: 'shipping-user', org_id: 'org1', email: null, phone: null, display_name: null }
const request = (forwardedHeaders = {}) => new NextRequest('https://example.test/api/navigation', {
  headers: { Authorization: 'Bearer verified-token', ...forwardedHeaders },
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireAuth).mockResolvedValue(user)
})

it.each([
  [true, false, false, false, ['/shipping']],
  [false, true, false, false, ['/shipping']],
  [false, true, true, false, ['/shipping']],
  [false, false, false, true, ['/shipping/settings', '/configs']],
  [false, true, false, true, ['/shipping', '/shipping/settings', '/configs']],
  [true, false, false, true, ['/shipping', '/shipping/settings', '/configs']],
  [false, false, false, false, []],
] as const)('projects workbench, owner, and settings entries for operate=%s, read own=%s, submit own=%s and settings=%s', async (canOperate, canViewOwn, canSubmitOwn, canManageConnections, paths) => {
  vi.mocked(resolveShippingEntry).mockResolvedValue({ orgId: 'org1', canOperate, canViewOwn, canSubmitOwn, canManageConnections, canReadLegacyReceipt: false, permissions: [], ownerPermissions: [] })
  const response = await GET(request())
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(await response.json()).toEqual({ paths })
  expect(resolveShippingEntry).toHaveBeenCalledWith(user, 'verified-token')
})

it('returns no links after the current organization, authorization source, or authentication is unavailable', async () => {
  vi.mocked(resolveShippingEntry).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('Registry unavailable'))
  const missing = await GET(request())
  expect(missing.status).toBe(403)
  expect(await missing.json()).toEqual({ paths: [] })
  const unavailable = await GET(request())
  expect(unavailable.status).toBe(503)
  expect(await unavailable.json()).toEqual({ paths: [] })
  vi.mocked(requireAuth).mockRejectedValueOnce(new AuthError())
  const unauthenticated = await GET(request())
  expect(unauthenticated.status).toBe(401)
  expect(await unauthenticated.json()).toEqual({ paths: [] })
  expect(resolveShippingEntry).toHaveBeenCalledTimes(2)
})

it('projects only the department workbench when the session has no other business entry', async () => {
  const response = await GET(request({ 'x-user-navigation-scope': 'department-workbench' }))
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(await response.json()).toEqual({ paths: ['/'], onlyProjectedPaths: true })
  expect(resolveShippingEntry).not.toHaveBeenCalled()
})

it.each([
  ['department-ledger', ['/shipping']],
  ['workbench-and-ledger', ['/', '/shipping']],
])('projects the verified %s navigation without unrelated destinations', async (scope, paths) => {
  vi.mocked(resolveShippingEntry).mockResolvedValue({
    orgId: 'org1', canOperate: false, canViewOwn: false, canSubmitOwn: false, canManageConnections: false,
    canReadLegacyReceipt: false, permissions: [], ownerPermissions: [],
    departmentLedger: [{ id: 'north', name: '华北', parentId: null }],
  })
  const response = await GET(request({ 'x-user-navigation-scope': scope }))
  expect(await response.json()).toEqual({ paths, onlyProjectedPaths: true })
})

it('shows configuration for an available organization tab independently from shipping', async () => {
  vi.mocked(resolveShippingEntry).mockResolvedValue({
    orgId: 'org1', canOperate: false, canViewOwn: false, canSubmitOwn: false, canManageConnections: false,
    canReadLegacyReceipt: false, permissions: [], ownerPermissions: [],
  })
  const response = await GET(request({ 'x-user-permissions': 'dept:directory_view' }))
  expect(await response.json()).toEqual({ paths: ['/configs'] })
})

it('projects an organization-only employee authorization and removes only that entry when denied', async () => {
  vi.mocked(resolveShippingEntry).mockResolvedValue({
    orgId: 'org1', canOperate: false, canViewOwn: false, canSubmitOwn: false, canManageConnections: false,
    canReadLegacyReceipt: false, permissions: [], ownerPermissions: [],
  })
  const granted = await GET(request({
    'x-user-navigation-scope': 'scoped',
    [ORGANIZATION_ACTIONS_HEADER]: JSON.stringify(resolveOrganizationPermissionDecision(['user:view'])),
  }))
  expect(await granted.json()).toEqual({ paths: ['/configs'], onlyProjectedPaths: true })
  vi.mocked(resolveShippingEntry).mockResolvedValue({
    orgId: 'org1', canOperate: true, canViewOwn: false, canSubmitOwn: false, canManageConnections: false,
    canReadLegacyReceipt: false, permissions: ['shipping:ledger_view'], ownerPermissions: [],
  })
  const denied = await GET(request({
    'x-user-navigation-scope': 'scoped',
    'x-user-permissions': 'org:write,dept:write,user:*,role:view,shipping:ledger_view',
    [ORGANIZATION_ACTIONS_HEADER]: JSON.stringify(resolveOrganizationPermissionDecision([])),
  }))
  expect(await denied.json()).toEqual({ paths: ['/shipping'], onlyProjectedPaths: true })
})

it.each([
  {
    scope: 'scoped', permissions: 'role:manage', canViewOwn: true,
    paths: ['/shipping', '/configs'],
  },
  {
    scope: 'scoped-with-workbench', permissions: 'dept:directory_view',
    paths: ['/', '/configs'],
  },
  {
    scope: 'scoped-with-workbench', permissions: '', canOperate: true, canManageConnections: true,
    paths: ['/', '/shipping', '/shipping/settings', '/configs'],
  },
  {
    scope: 'scoped-with-workbench', permissions: 'role:manage', canViewOwn: true,
    departmentLedger: [{ id: 'south', name: '华南', parentId: null }],
    paths: ['/', '/shipping', '/configs'],
  },
  {
    scope: 'scoped', permissions: '',
    paths: [],
  },
])('limits a $scope session with $permissions to authorized business paths', async ({
  scope, permissions, canViewOwn = false, canOperate = false, canManageConnections = false, departmentLedger, paths,
}) => {
  vi.mocked(resolveShippingEntry).mockResolvedValue({
    orgId: 'org1', canOperate, canViewOwn, canSubmitOwn: false, canManageConnections,
    canReadLegacyReceipt: false, permissions: [], ownerPermissions: [], departmentLedger,
  })
  const response = await GET(request({
    'x-user-navigation-scope': scope,
    'x-user-permissions': permissions,
  }))
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('private, no-store')
  expect(await response.json()).toEqual({ paths, onlyProjectedPaths: true })
})

it('does not use the forwarded settings flag when shipping did not authorize settings', async () => {
  vi.mocked(resolveShippingEntry).mockResolvedValue({
    orgId: 'org1', canOperate: false, canViewOwn: true, canSubmitOwn: false, canManageConnections: false,
    canReadLegacyReceipt: false, permissions: [], ownerPermissions: ['shipping:owner_view'],
  })
  const response = await GET(request({ 'x-user-navigation-scope': 'shipping-only', 'x-user-shipping-settings-view': '1' }))
  expect(await response.json()).toEqual({ paths: ['/shipping'], onlyProjectedPaths: true })
})
