/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const registry = vi.hoisted(() => ({
  canManagePlatformPermissionRegistry: vi.fn(),
  loadPermissionDefinition: vi.fn(),
  softDeletePermissionDefinition: vi.fn(),
  transitionPermissionDefinition: vi.fn(),
  updatePermissionDefinition: vi.fn(),
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

import { DELETE, GET, PATCH } from './route'

const context: any = { params: Promise.resolve({ id: 'permission-1' }) }

function request(method: string, body?: unknown): any {
  return {
    method,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: vi.fn(async () => body),
  }
}

describe('/api/admin/permissions/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registry.canManagePlatformPermissionRegistry.mockResolvedValue(true)
    registry.loadPermissionDefinition.mockResolvedValue({ id: 'permission-1', key: 'report:read' })
    registry.updatePermissionDefinition.mockResolvedValue({ id: 'permission-1', key: 'report:read', status: 'draft' })
    registry.transitionPermissionDefinition.mockResolvedValue({ id: 'permission-1', key: 'report:read', status: 'published' })
    registry.softDeletePermissionDefinition.mockResolvedValue({ id: 'permission-1', status: 'deleted' })
  })

  it('reads one registry definition', async () => {
    const response = await GET(request('GET'), context)
    expect(response.status).toBe(200)
    expect(registry.loadPermissionDefinition).toHaveBeenCalledWith('permission-1')
  })

  it('edits drafts through the lifecycle API', async () => {
    const response = await PATCH(request('PATCH', { label: '新名称' }), context)
    expect(response.status).toBe(200)
    expect(registry.updatePermissionDefinition).toHaveBeenCalledWith('admin-1', 'permission-1', { label: '新名称' })
  })

  it('publishes only through an explicit lifecycle action', async () => {
    const response = await PATCH(request('PATCH', { action: 'publish', reason: 'consumer verified' }), context)
    expect(response.status).toBe(200)
    expect(registry.transitionPermissionDefinition).toHaveBeenCalledWith(
      'admin-1',
      'permission-1',
      'publish',
      'consumer verified',
    )
  })

  it('uses soft delete rather than removing grant history', async () => {
    const response = await DELETE(request('DELETE', { reason: 'retired' }), context)
    expect(response.status).toBe(200)
    expect(registry.softDeletePermissionDefinition).toHaveBeenCalledWith('admin-1', 'permission-1', 'retired')
  })
})
