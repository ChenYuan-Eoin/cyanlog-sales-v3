/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api/auth-wrapper', () => ({
  withAuthAndOrg: vi.fn(async (_req, handler) => handler({ id: 'user-1' }, 'org-1')),
}))

const accessMocks = vi.hoisted(() => ({
  userHasOrgConfigAccess: vi.fn(),
}))

vi.mock('@/lib/configs/access', () => accessMocks)

import { PATCH } from './route'

function jsonRequest(body: unknown): any {
  return {
    json: vi.fn(async () => body),
    method: 'PATCH',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

const routeContext: any = {
  params: Promise.resolve({ id: 'role-1' }),
}

describe('PATCH /api/roles/[id] global-role boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(true)
  })

  it('没有当前组织 config:write 时返回 403', async () => {
    accessMocks.userHasOrgConfigAccess.mockResolvedValue(false)

    const res = await PATCH(jsonRequest({ permissions: ['*'] }), routeContext)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.error.code).toBe('A002')
    expect(accessMocks.userHasOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'write')
  })

  it.each([
    ['普通权限', ['config:read']],
    ['全局通配权限', ['*']],
    ['清空权限', []],
  ])('即使有写权限也禁止在线修改全局角色：%s', async (_label, permissions) => {
    const req = jsonRequest({ permissions })

    const res = await PATCH(req, routeContext)
    const body = await res.json()

    expect(res.status).toBe(409)
    expect(body.error.message).toContain('全局只读模板')
    expect(req.json).not.toHaveBeenCalled()
  })
})
