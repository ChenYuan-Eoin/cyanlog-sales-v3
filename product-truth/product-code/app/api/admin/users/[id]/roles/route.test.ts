/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  getFreshDefaultOrgId: vi.fn(),
  getFreshUserScopedRoleAssignments: vi.fn(),
  canMutateOrgUsers: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

vi.mock('@/lib/admin/org-role-authority', () => ({
  validateOrgRoleAssignment: vi.fn(),
  userHasOrgRoleCode: vi.fn(),
}))

import { requireAuth } from '@/lib/auth'
import {
  canMutateOrgUsers,
  getFreshDefaultOrgId,
  getFreshUserScopedRoleAssignments,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import {
  userHasOrgRoleCode,
  validateOrgRoleAssignment,
} from '@/lib/admin/org-role-authority'
import { POST } from './route'

const routeContext: any = {
  params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000001' }),
}

const roleId = '11111111-1111-1111-1111-111111111111'

function malformedJsonRequest(): any {
  return new Request('https://example.test/api/admin/users/u-1/roles', {
    method: 'POST',
    body: '{bad-json',
  })
}

function jsonRequest(body: unknown): any {
  return new Request('https://example.test/api/admin/users/u-1/roles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeUserLookupQuery(result: { data: unknown; error: unknown }) {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
  }
  return query
}

function makeRoleListQuery(result: { data: unknown; error: unknown }) {
  const query: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
      Promise.resolve(result).then(resolve, reject)
    ),
  }
  return query
}

describe('POST /api/admin/users/[id]/roles validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'admin-user' })
    ;(getFreshDefaultOrgId as any).mockResolvedValue('org-1')
    ;(getFreshUserScopedRoleAssignments as any).mockResolvedValue([{ scopeType: 'org', scopeId: 'org-1' }])
    ;(canMutateOrgUsers as any).mockReturnValue(true)
    ;(userHasOrgRoleCode as any).mockResolvedValue(false)
    ;(validateOrgRoleAssignment as any).mockResolvedValue({ ok: true, roleIds: [roleId] })
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: true, error: null })
  })

  it('无效 JSON 返回参数错误且不访问数据库', async () => {
    const res = await POST(malformedJsonRequest(), routeContext)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('非法角色 ID 返回参数错误且不访问数据库', async () => {
    const res = await POST(jsonRequest({ role_ids: ['bad-role'] }), routeContext)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('无组织管理权限时返回 403 且不访问数据库', async () => {
    ;(canMutateOrgUsers as any).mockReturnValue(false)

    const res = await POST(jsonRequest({ role_ids: [roleId] }), routeContext)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('NO_PERMISSION')
    expect(canMutateOrgUsers).toHaveBeenCalledWith(
      [{ scopeType: 'org', scopeId: 'org-1' }],
      'org-1'
    )
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('目标用户不存在时返回 404 且不替换角色', async () => {
    const query = makeUserLookupQuery({ data: null, error: null })
    ;(supabaseAdmin.from as any).mockReturnValue(query)

    const res = await POST(jsonRequest({ role_ids: [roleId] }), routeContext)

    expect(res.status).toBe(404)
    expect(supabaseAdmin.from).toHaveBeenCalledWith('users')
    expect(query.eq).toHaveBeenCalledWith('id', '00000000-0000-0000-0000-000000000001')
    expect(query.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('成功替换用户组织角色并返回写入结果', async () => {
    const userQuery = makeUserLookupQuery({
      data: { id: '00000000-0000-0000-0000-000000000001', display_name: '测试用户' },
      error: null,
    })
    const roleQuery = makeRoleListQuery({
      data: [{ role_id: roleId, scope_type: 'org', scope_id: 'org-1' }],
      error: null,
    })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(userQuery)
      .mockReturnValueOnce(makeRoleListQuery({ data: null, error: { code: 'PGRST205' } }))
      .mockReturnValueOnce(roleQuery)

    const res = await POST(jsonRequest({ role_ids: [roleId, roleId] }), routeContext)
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toEqual([{ role_id: roleId, scope_type: 'org', scope_id: 'org-1' }])
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'admin_replace_org_roles_v1',
      expect.objectContaining({
        p_actor_id: 'admin-user',
        p_org_id: 'org-1',
        p_user_id: '00000000-0000-0000-0000-000000000001',
        p_role_ids: [roleId],
      }),
    )
  })

  it('returns pending role ids separately from effective scopes after preassignment', async () => {
    const lookup = makeUserLookupQuery({ data: { id: 'member' }, error: null })
    const pending = makeRoleListQuery({ data: [{ role_id: roleId }], error: null })
    ;(supabaseAdmin.from as any).mockReturnValueOnce(lookup)
      .mockReturnValueOnce(pending)
      .mockReturnValueOnce(makeRoleListQuery({ data: [], error: null }))
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: 'saved', error: null })
    const res = await POST(jsonRequest({ role_ids: [roleId], expected_role_ids: [] }), routeContext)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'admin_replace_org_roles_if_current_v1', expect.objectContaining({ p_expected_role_ids: [] }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ data: [], pending_role_ids: [roleId] })
    expect(pending.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(pending.eq).toHaveBeenCalledWith('user_id', '00000000-0000-0000-0000-000000000001')
  })

  it.each([
    ['conflict', null, 409, 'ROLE_ASSIGNMENT_CHANGED'],
    ['ineligible', null, 409, 'MEMBER_NOT_ELIGIBLE'],
    [null, { code: 'PGRST202' }, 503, 'ROLE_ASSIGNMENT_UPDATING'],
  ])('does not retry a conditional save after %j / %j', async (data, error, status, code) => {
    ;(supabaseAdmin.from as any).mockReturnValueOnce(makeUserLookupQuery({ data: { id: 'member' }, error: null }))
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data, error })
    const res = await POST(jsonRequest({ role_ids: [], expected_role_ids: [roleId] }), routeContext)
    expect(res.status).toBe(status)
    expect((await res.json()).code).toBe(code)
    expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'admin_replace_org_roles_if_current_v1', expect.objectContaining({ p_expected_role_ids: [roleId] }),
    )
  })

  it('禁止操作者修改自己的角色', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: '00000000-0000-0000-0000-000000000001' })

    const res = await POST(jsonRequest({ role_ids: [roleId] }), routeContext)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('SELF_ROLE_MUTATION_FORBIDDEN')
    expect(validateOrgRoleAssignment).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('禁止分配超过操作者权限上限的角色', async () => {
    const query = makeUserLookupQuery({
      data: { id: '00000000-0000-0000-0000-000000000001', display_name: '测试用户' },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValue(query)
    ;(validateOrgRoleAssignment as any).mockResolvedValue({
      ok: false,
      reason: 'ROLE_ESCALATION_FORBIDDEN',
    })

    const res = await POST(jsonRequest({ role_ids: [roleId] }), routeContext)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('ROLE_ESCALATION_FORBIDDEN')
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('禁止组织接口变更现有平台根管理员', async () => {
    const query = makeUserLookupQuery({
      data: { id: '00000000-0000-0000-0000-000000000001', display_name: '根管理员' },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValue(query)
    ;(userHasOrgRoleCode as any).mockResolvedValue(true)

    const res = await POST(jsonRequest({ role_ids: [] }), routeContext)
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('PROTECTED_ROLE_MUTATION_FORBIDDEN')
    expect(validateOrgRoleAssignment).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('角色不存在时返回 400', async () => {
    const query = makeUserLookupQuery({
      data: { id: '00000000-0000-0000-0000-000000000001', display_name: '测试用户' },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValue(query)
    ;(validateOrgRoleAssignment as any).mockResolvedValue({ ok: false, reason: 'ROLE_NOT_FOUND' })

    const res = await POST(jsonRequest({ role_ids: [roleId] }), routeContext)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('部分角色不存在')
  })
})
