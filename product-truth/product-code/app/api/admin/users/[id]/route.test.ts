/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))

vi.mock('@/lib/scoped-access', () => ({
  canMutateOrgUsers: vi.fn(),
  getDefaultOrgId: vi.fn(),
  getFreshUserScopedRoleAssignments: vi.fn(),
}))

vi.mock('@/lib/admin/org-membership', () => ({
  assertDepartmentInOrg: vi.fn(),
  syncPrimaryDepartmentMembership: vi.fn(),
  syncUserSalesSpaces: vi.fn(),
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
import { assertDepartmentInOrg } from '@/lib/admin/org-membership'
import { userHasOrgRoleCode } from '@/lib/admin/org-role-authority'
import { supabaseAdmin } from '@/lib/supabase'
import { DELETE, PATCH } from './route'

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const targetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const orgId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const routeContext: any = {
  params: Promise.resolve({ id: targetId }),
}

function patchRequest(body: unknown): any {
  return new Request(`https://example.test/api/admin/users/${targetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function malformedJsonRequest(): any {
  return new Request(`https://example.test/api/admin/users/${targetId}`, {
    method: 'PATCH',
    body: '{bad-json',
  })
}

function deleteRequest(): any {
  return new Request(`https://example.test/api/admin/users/${targetId}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': 'request-offboard-1',
    },
    body: JSON.stringify({ reason: 'resignation accepted' }),
  })
}

function makeQuery(result: { data?: unknown; error?: unknown }) {
  const query: any = {}
  ;['select', 'update', 'delete', 'eq'].forEach((method) => {
    query[method] = vi.fn().mockReturnValue(query)
  })
  query.maybeSingle = vi.fn().mockResolvedValue(result)
  query.single = vi.fn().mockResolvedValue(result)
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return query
}

function targetUser(overrides: Record<string, unknown> = {}) {
  return {
    id: targetId,
    email: 'user@example.test',
    display_name: '普通用户',
    title: null,
    primary_dept_id: null,
    status: 'active',
    login_enabled: true,
    report_to_user_id: null,
    ...overrides,
  }
}

describe('/api/admin/users/[id] account lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: actorId })
    ;(getDefaultOrgId as any).mockResolvedValue(orgId)
    ;(getFreshUserScopedRoleAssignments as any).mockResolvedValue([
      { scopeType: 'org', scopeId: orgId, roleCode: 'ADMIN', permissions: ['user:write'] },
    ])
    ;(canMutateOrgUsers as any).mockReturnValue(true)
    ;(userHasOrgRoleCode as any).mockResolvedValue(false)
    ;(assertDepartmentInOrg as any).mockResolvedValue({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: true, error: null })
  })

  it('无效 JSON 返回参数错误且不读写目标用户', async () => {
    const response = await PATCH(malformedJsonRequest(), routeContext)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
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
  ])('%s 不能更新用户，且不查询或写入目标', async (_label, assignments) => {
    ;(getFreshUserScopedRoleAssignments as any).mockResolvedValue(assignments)
    ;(canMutateOrgUsers as any).mockReturnValue(false)

    const response = await PATCH(patchRequest({ display_name: '新姓名' }), routeContext)

    expect(response.status).toBe(403)
    expect(getFreshUserScopedRoleAssignments).toHaveBeenCalledWith(actorId)
    expect(canMutateOrgUsers).toHaveBeenCalledWith(assignments, orgId)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('拒绝在同一请求中混合账户状态和普通资料变更', async () => {
    const response = await PATCH(
      patchRequest({ display_name: '新姓名', status: 'suspended' }),
      routeContext
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('MIXED_ACCOUNT_STATE_UPDATE')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('禁止操作者通过通用 PATCH 停用自己', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: targetId })

    const response = await PATCH(patchRequest({ status: 'suspended' }), routeContext)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('SELF_ACCOUNT_STATE_MUTATION_FORBIDDEN')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(userHasOrgRoleCode).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('仍允许有权限的操作者编辑自己的普通资料', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: targetId })
    const lookup = makeQuery({ data: targetUser(), error: null })
    const update = makeQuery({
      data: targetUser({ display_name: '新姓名' }),
      error: null,
    })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(lookup)
      .mockReturnValueOnce(update)

    const response = await PATCH(patchRequest({ display_name: '新姓名' }), routeContext)

    expect(response.status).toBe(200)
    expect(update.update).toHaveBeenCalledWith({ display_name: '新姓名' })
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('不允许修改当前组织的 SUPER_ADMIN', async () => {
    const lookup = makeQuery({ data: targetUser(), error: null })
    ;(supabaseAdmin.from as any).mockReturnValue(lookup)
    ;(userHasOrgRoleCode as any).mockResolvedValue(true)

    const response = await PATCH(patchRequest({ display_name: '新姓名' }), routeContext)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('PROTECTED_ROLE_MUTATION_FORBIDDEN')
    expect(userHasOrgRoleCode).toHaveBeenCalledWith(targetId, orgId, 'SUPER_ADMIN')
    expect(lookup.update).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('停用用户只通过原子 RPC 变更状态并撤销会话', async () => {
    const lookup = makeQuery({ data: targetUser(), error: null })
    ;(supabaseAdmin.from as any).mockReturnValue(lookup)

    const response = await PATCH(patchRequest({ status: 'suspended' }), routeContext)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.status).toBe('suspended')
    expect(lookup.update).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'admin_set_account_state_v1',
      {
        p_actor_id: actorId,
        p_org_id: orgId,
        p_user_id: targetId,
        p_status: 'suspended',
        p_login_enabled: null,
        p_reason: 'tenant administrator account state update',
        p_request_id: null,
      }
    )
  })

  it('重新启用用户也必须走同一 RPC，使历史 token 无法复活', async () => {
    const lookup = makeQuery({ data: targetUser({ status: 'suspended' }), error: null })
    ;(supabaseAdmin.from as any).mockReturnValue(lookup)

    const response = await PATCH(patchRequest({ status: 'active' }), routeContext)

    expect(response.status).toBe(200)
    expect(lookup.update).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'admin_set_account_state_v1',
      {
        p_actor_id: actorId,
        p_org_id: orgId,
        p_user_id: targetId,
        p_status: 'active',
        p_login_enabled: null,
        p_reason: 'tenant administrator account state update',
        p_request_id: null,
      }
    )
  })

  it('账户状态 RPC 失败时返回 500，不回退到普通 update', async () => {
    const lookup = makeQuery({ data: targetUser(), error: null })
    ;(supabaseAdmin.from as any).mockReturnValue(lookup)
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: null,
      error: { message: 'transaction failed' },
    })

    const response = await PATCH(patchRequest({ status: 'inactive' }), routeContext)

    expect(response.status).toBe(500)
    expect(lookup.update).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('普通资料字段仍以当前组织作为最终写入边界', async () => {
    const lookup = makeQuery({ data: targetUser(), error: null })
    const update = makeQuery({
      data: targetUser({ display_name: '新姓名' }),
      error: null,
    })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(lookup)
      .mockReturnValueOnce(update)

    const response = await PATCH(patchRequest({ display_name: '新姓名' }), routeContext)

    expect(response.status).toBe(200)
    expect(update.update).toHaveBeenCalledWith({ display_name: '新姓名' })
    expect(update.eq).toHaveBeenCalledWith('id', targetId)
    expect(update.eq).toHaveBeenCalledWith('org_id', orgId)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('无用户写权限时不能办理离职', async () => {
    ;(canMutateOrgUsers as any).mockReturnValue(false)

    const response = await DELETE(deleteRequest(), routeContext)

    expect(response.status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('不允许为当前组织的 SUPER_ADMIN 办理离职', async () => {
    const lookup = makeQuery({ data: targetUser(), error: null })
    ;(supabaseAdmin.from as any).mockReturnValue(lookup)
    ;(userHasOrgRoleCode as any).mockResolvedValue(true)

    const response = await DELETE(deleteRequest(), routeContext)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('PROTECTED_ROLE_MUTATION_FORBIDDEN')
    expect(lookup.update).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('离职通过原子 RPC 结束成员关系、撤销授权和会话并记录原因', async () => {
    const lookup = makeQuery({ data: targetUser(), error: null })
    ;(supabaseAdmin.from as any).mockReturnValue(lookup)

    const response = await DELETE(deleteRequest(), routeContext)

    expect(response.status).toBe(200)
    expect(lookup.update).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'admin_offboard_member_v1',
      {
        p_actor_id: actorId,
        p_org_id: orgId,
        p_user_id: targetId,
        p_reason: 'resignation accepted',
        p_request_id: 'request-offboard-1',
      }
    )
  })

  it('离职 RPC 失败时返回 500 且不执行非原子 update', async () => {
    const lookup = makeQuery({ data: targetUser(), error: null })
    ;(supabaseAdmin.from as any).mockReturnValue(lookup)
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: null,
      error: { message: 'session delete failed' },
    })

    const response = await DELETE(deleteRequest(), routeContext)

    expect(response.status).toBe(500)
    expect(lookup.update).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('主部门调岗通过专用原子命令而不是先更新用户后补关系', async () => {
    const departmentId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    const lookup = makeQuery({ data: targetUser(), error: null })
    ;(supabaseAdmin.from as any).mockReturnValue(lookup)

    const response = await PATCH(patchRequest({ primary_dept_id: departmentId }), routeContext)

    expect(response.status).toBe(200)
    expect(lookup.update).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'admin_transfer_primary_department_v1',
      expect.objectContaining({
        p_actor_id: actorId,
        p_org_id: orgId,
        p_user_id: targetId,
        p_department_id: departmentId,
      }),
    )
  })
})
