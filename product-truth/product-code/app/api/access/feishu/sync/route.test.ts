import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  defaultOrgId: vi.fn(),
  assignments: vi.fn(),
  canMutateDepartments: vi.fn(),
  canMutateUsers: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({ requireAuth: mocks.requireAuth }))
vi.mock('@/lib/scoped-access', () => ({
  canMutateOrgDepartments: mocks.canMutateDepartments,
  canMutateOrgUsers: mocks.canMutateUsers,
  getFreshDefaultOrgId: mocks.defaultOrgId,
  getFreshUserScopedRoleAssignments: mocks.assignments,
}))

import { POST } from './route'

function request(orgId?: string) {
  return new NextRequest('https://example.test/api/access/feishu/sync', {
    method: 'POST',
    headers: orgId ? { 'x-org-id': orgId } : undefined,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAuth.mockResolvedValue({ id: 'user-1' })
  mocks.defaultOrgId.mockResolvedValue('org-1')
  mocks.assignments.mockResolvedValue([{ scopeType: 'org', scopeId: 'org-1' }])
  mocks.canMutateDepartments.mockReturnValue(true)
  mocks.canMutateUsers.mockReturnValue(true)
})

describe('POST /api/access/feishu/sync', () => {
  it('retires the direct-write endpoint and points callers to the provider-neutral cutover', async () => {
    const response = await POST(request())

    expect(response.status).toBe(410)
    expect(await response.json()).toEqual({
      code: 'DIRECTORY_CUTOVER_REQUIRED',
      error: '旧版飞书组织直写接口已停用。请从“外部系统接入”检查目录读取范围、生成不可变差异并显式确认切换。',
    })
  })

  it('requires current organization directory-management authority', async () => {
    mocks.canMutateUsers.mockReturnValue(false)

    const response = await POST(request('org-1'))

    expect(response.status).toBe(403)
    expect(mocks.canMutateDepartments).toHaveBeenCalledWith([{ scopeType: 'org', scopeId: 'org-1' }], 'org-1')
    expect(mocks.canMutateUsers).toHaveBeenCalledWith([{ scopeType: 'org', scopeId: 'org-1' }], 'org-1')
  })

  it('rejects a caller without an effective organization', async () => {
    mocks.defaultOrgId.mockResolvedValue(null)

    const response = await POST(request())

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'NO_ORGANIZATION' })
  })

  it('maps authentication failures without exposing an actionable write route', async () => {
    const authError = new Error('missing session')
    authError.name = 'AuthError'
    mocks.requireAuth.mockRejectedValue(authError)

    const response = await POST(request())

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ code: 'UNAUTHORIZED' })
  })
})
