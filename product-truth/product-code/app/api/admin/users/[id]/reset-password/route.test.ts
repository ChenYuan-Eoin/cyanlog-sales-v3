/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  canMutateOrgUsers: vi.fn(),
  getDefaultOrgId: vi.fn(),
  getFreshUserScopedRoleAssignments: vi.fn(),
}))

vi.mock('@/lib/admin/org-membership', () => ({
  createAdminTempPassword: vi.fn(),
  hashAdminPassword: vi.fn(),
}))

vi.mock('@/lib/admin/org-role-authority', () => ({
  userHasOrgRoleCode: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
import {
  canMutateOrgUsers,
  getDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import {
  createAdminTempPassword,
  hashAdminPassword,
} from '@/lib/admin/org-membership'
import { userHasOrgRoleCode } from '@/lib/admin/org-role-authority'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const targetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const orgId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const tempPassword = 'Cyan!test-password'

const routeContext: any = {
  params: Promise.resolve({ id: targetId }),
}

function makeRequest(): any {
  return new Request(`https://example.test/api/admin/users/${targetId}/reset-password`, {
    method: 'POST',
  })
}

function makeUserLookup(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
}

describe('POST /api/admin/users/[id]/reset-password', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: actorId })
    ;(getDefaultOrgId as any).mockResolvedValue(orgId)
    ;(getFreshUserScopedRoleAssignments as any).mockResolvedValue([
      { scopeType: 'org', scopeId: orgId, roleCode: 'ADMIN', permissions: ['user:write'] },
    ])
    ;(canMutateOrgUsers as any).mockReturnValue(true)
    ;(userHasOrgRoleCode as any).mockResolvedValue(false)
    ;(createAdminTempPassword as any).mockReturnValue(tempPassword)
    ;(hashAdminPassword as any).mockResolvedValue('bcrypt-hash')
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: true, error: null })
  })

  it.each([
    [
      'user:view',
      [{ scopeType: 'org', scopeId: orgId, roleCode: 'VIEWER', permissions: ['user:view'] }],
    ],
    [
      'SALES_OPS',
      [{ scopeType: 'org', scopeId: orgId, roleCode: 'SALES_OPS', permissions: [] }],
    ],
    [
      '其他组织的 user:write',
      [{ scopeType: 'org', scopeId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', roleCode: 'ADMIN', permissions: ['user:write'] }],
    ],
  ])('%s 不能重置密码，且不查询目标用户', async (_label, assignments) => {
    ;(getFreshUserScopedRoleAssignments as any).mockResolvedValue(assignments)
    ;(canMutateOrgUsers as any).mockReturnValue(false)

    const response = await POST(makeRequest(), routeContext)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('NO_PERMISSION')
    expect(getFreshUserScopedRoleAssignments).toHaveBeenCalledWith(actorId)
    expect(canMutateOrgUsers).toHaveBeenCalledWith(assignments, orgId)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(userHasOrgRoleCode).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('不允许管理员通过管理接口重置自己的密码', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: targetId })

    const response = await POST(makeRequest(), routeContext)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('SELF_PASSWORD_RESET_FORBIDDEN')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('目标用户必须属于当前组织', async () => {
    const lookup = makeUserLookup({ data: null, error: null })
    ;(supabaseAdmin.from as any).mockReturnValue(lookup)

    const response = await POST(makeRequest(), routeContext)

    expect(response.status).toBe(404)
    expect(lookup.eq).toHaveBeenCalledWith('id', targetId)
    expect(lookup.eq).toHaveBeenCalledWith('org_id', orgId)
    expect(userHasOrgRoleCode).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('禁止重置 SUPER_ADMIN 的密码', async () => {
    const lookup = makeUserLookup({
      data: { id: targetId, display_name: '平台根管理员', email: 'root@example.test', org_id: orgId },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValue(lookup)
    ;(userHasOrgRoleCode as any).mockResolvedValue(true)

    const response = await POST(makeRequest(), routeContext)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('PROTECTED_ROLE_MUTATION_FORBIDDEN')
    expect(userHasOrgRoleCode).toHaveBeenCalledWith(targetId, orgId, 'SUPER_ADMIN')
    expect(createAdminTempPassword).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('通过原子 RPC 更新密码并撤销会话', async () => {
    const lookup = makeUserLookup({
      data: { id: targetId, display_name: '普通用户', email: 'user@example.test', org_id: orgId },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValue(lookup)

    const response = await POST(makeRequest(), routeContext)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      data: {
        tempPassword,
        userId: targetId,
        displayName: '普通用户',
      },
    })
    expect(createAdminTempPassword).toHaveBeenCalledOnce()
    expect(hashAdminPassword).toHaveBeenCalledWith(tempPassword)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'admin_reset_password_v1',
      {
        p_actor_id: actorId,
        p_org_id: orgId,
        p_user_id: targetId,
        p_password_hash: 'bcrypt-hash',
        p_request_id: null,
      }
    )
  })

  it('RPC 失败时返回 500 且不泄漏已生成的临时密码', async () => {
    const lookup = makeUserLookup({
      data: { id: targetId, display_name: '普通用户', email: 'user@example.test', org_id: orgId },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValue(lookup)
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: null,
      error: { message: 'transaction failed' },
    })

    const response = await POST(makeRequest(), routeContext)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({ error: '重置密码失败' })
    expect(JSON.stringify(body)).not.toContain(tempPassword)
  })
})
