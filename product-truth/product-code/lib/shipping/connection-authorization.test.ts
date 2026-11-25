// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadOrgRolePermissionContext } from '@/lib/org-role-permissions'
import { loadShippingModulePermissionState } from '@/lib/permission-registry'
import { requireShippingConnectionManager } from './connection-authorization'

vi.mock('@/lib/org-role-permissions', () => ({ loadOrgRolePermissionContext: vi.fn() }))
vi.mock('@/lib/permission-registry', () => ({ loadShippingModulePermissionState: vi.fn() }))

const publication = (keys: string[]) => ({ published: new Set(keys), registered: new Set(keys) })
const context = { orgId: 'org-a', settings: {}, canRead: false, canEdit: false, canEditPlatformRoot: false }

describe('shipping connection effective authority', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(loadShippingModulePermissionState).mockResolvedValue(publication(['shipping:operate', 'shipping:manage_connections']))
    vi.mocked(loadOrgRolePermissionContext).mockResolvedValue({ ...context, actorPermissions: [] })
  })

  it('requires the current effective connection permission and keeps operator access distinct', async () => {
    await expect(requireShippingConnectionManager('manager')).rejects.toMatchObject({ status: 403 })
    vi.mocked(loadOrgRolePermissionContext).mockResolvedValue({ ...context, actorPermissions: ['shipping:operate'] })
    await expect(requireShippingConnectionManager('operator')).rejects.toMatchObject({ status: 403 })
    vi.mocked(loadOrgRolePermissionContext).mockResolvedValue({ ...context, actorPermissions: ['shipping:manage_connections'] })
    await expect(requireShippingConnectionManager('manager')).resolves.toBe('org-a')
  })

  it('allows a platform grant only with an exact active current org and a published definition', async () => {
    vi.mocked(loadOrgRolePermissionContext).mockResolvedValue({ ...context, actorPermissions: ['*'] })
    await expect(requireShippingConnectionManager('root')).resolves.toBe('org-a')
    vi.mocked(loadShippingModulePermissionState).mockResolvedValueOnce(publication(['shipping:operate']))
    await expect(requireShippingConnectionManager('root')).rejects.toMatchObject({ status: 403 })
    vi.mocked(loadOrgRolePermissionContext).mockResolvedValueOnce(null)
    await expect(requireShippingConnectionManager('root')).rejects.toMatchObject({ status: 403 })
  })

  it('returns unavailable for an unreadable authorization context', async () => {
    vi.mocked(loadOrgRolePermissionContext).mockRejectedValueOnce(new Error('database unavailable'))
    await expect(requireShippingConnectionManager('manager')).rejects.toMatchObject({ status: 503 })
  })
})
