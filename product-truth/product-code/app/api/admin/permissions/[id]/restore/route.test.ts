/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const registry = vi.hoisted(() => ({
  canManagePlatformPermissionRegistry: vi.fn(),
  restorePermissionDefinition: vi.fn(),
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

import { POST } from './route'

describe('/api/admin/permissions/[id]/restore', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registry.canManagePlatformPermissionRegistry.mockResolvedValue(true)
    registry.restorePermissionDefinition.mockResolvedValue({ id: 'permission-1', status: 'draft', version: 2 })
  })

  it('restores a soft-deleted definition as a new draft version', async () => {
    const response = await POST({} as any, { params: Promise.resolve({ id: 'permission-1' }) } as any)
    expect(response.status).toBe(200)
    expect(registry.restorePermissionDefinition).toHaveBeenCalledWith('admin-1', 'permission-1')
    expect(await response.json()).toMatchObject({
      data: { definition: { status: 'draft', version: 2 } },
    })
  })
})
