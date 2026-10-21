/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
  getAuthUser: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: vi.fn(),
  getUserScopedRoleAssignments: vi.fn(),
  getOrgAuthorizationRoleCodes: vi.fn(),
  getOrgPermissions: vi.fn(),
}))

import { requireAuth } from '@/lib/auth'
import {
  getDefaultOrgId,
  getOrgPermissions,
  getOrgAuthorizationRoleCodes,
  getUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import { withPermission } from './auth-wrapper'

describe('withPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ id: 'user-1' } as any)
    vi.mocked(getDefaultOrgId).mockResolvedValue('org-a')
    vi.mocked(getUserScopedRoleAssignments).mockResolvedValue([])
    vi.mocked(getOrgAuthorizationRoleCodes).mockReturnValue([])
    vi.mocked(getOrgPermissions).mockReturnValue([])
  })

  it('按当前组织精确权限拒绝未授权调用', async () => {
    const handler = vi.fn()

    const response = await withPermission({} as any, 'config:publish', handler) as Response

    expect(response.status).toBe(403)
    expect(getOrgPermissions).toHaveBeenCalledWith([], 'org-a')
    expect(handler).not.toHaveBeenCalled()
  })

  it('覆盖后的超级管理员不会重新获得通配符', async () => {
    vi.mocked(getOrgAuthorizationRoleCodes).mockReturnValue([])
    vi.mocked(getOrgPermissions).mockReturnValue(['config:read'])
    const handler = vi.fn()
    const response = await withPermission({} as any, 'contract:review', handler) as Response
    expect(response.status).toBe(403)
    expect(handler).not.toHaveBeenCalled()
  })

  it('当前组织权限满足时执行 handler', async () => {
    vi.mocked(getOrgPermissions).mockReturnValue(['config:publish'])
    const handler = vi.fn(async () => new Response('ok'))

    const response = await withPermission({} as any, 'config:publish', handler) as Response

    expect(response.status).toBe(200)
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }))
  })
})
