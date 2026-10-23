/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const registry = vi.hoisted(() => ({
  canManagePlatformPermissionRegistry: vi.fn(),
  createPermissionDefinition: vi.fn(),
  listPermissionDefinitions: vi.fn(),
  PermissionRegistryError: class PermissionRegistryError extends Error {
    constructor(public code: string, message: string) {
      super(message)
    }
  },
}))
vi.mock('@/lib/permission-registry', () => registry)
vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: async (_req: unknown, handler: (user: { id: string }, orgId: string) => unknown) => (
    handler({ id: 'admin-1' }, 'platform-org')
  ),
}))

import { GET, POST } from './route'

function request(body?: unknown): any {
  return {
    method: body === undefined ? 'GET' : 'POST',
    url: 'https://example.test/api/admin/permissions',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: vi.fn(async () => body),
  }
}

describe('/api/admin/permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registry.canManagePlatformPermissionRegistry.mockResolvedValue(true)
    registry.listPermissionDefinitions.mockResolvedValue({
      source: 'database',
      definitions: [{ id: 'p1', key: 'report:finance', status: 'published' }],
    })
    registry.createPermissionDefinition.mockResolvedValue({ id: 'p2', key: 'report:read', status: 'draft' })
  })

  it('requires the explicitly configured platform registry organization', async () => {
    registry.canManagePlatformPermissionRegistry.mockResolvedValue(false)
    const response = await GET(request())
    expect(response.status).toBe(403)
    expect(registry.listPermissionDefinitions).not.toHaveBeenCalled()
  })

  it('lists lifecycle definitions without falling back to a tenant catalog', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      data: { source: 'database', definitions: [{ id: 'p1' }] },
    })
    expect(registry.listPermissionDefinitions).toHaveBeenCalledWith({
      includeUnpublished: true,
      allowFallback: false,
    })
  })

  it('creates a draft and returns 201', async () => {
    const response = await POST(request({ key: 'report:read', label: '报表读取', description: '读取报表。' }))
    expect(response.status).toBe(201)
    expect(registry.createPermissionDefinition).toHaveBeenCalledWith('admin-1', {
      key: 'report:read',
      label: '报表读取',
      description: '读取报表。',
    })
  })
})
