/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/admin/org-membership', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/admin/org-membership')>(),
  assertDepartmentInOrg: vi.fn(),
}))

vi.mock('@/lib/org-role-permissions', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/org-role-permissions')>(),
  loadCurrentOrganizationRoleAssignments: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
import { assertDepartmentInOrg } from '@/lib/admin/org-membership'
import { loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import { supabaseAdmin } from '@/lib/supabase'
import { DELETE, POST } from './route'

const routeContext: any = {
  params: Promise.resolve({ id: '00000000-0000-0000-0000-000000000001' }),
}

function makeRequest(body: unknown, url = 'https://example.test/api/admin/users/u-1/departments'): any {
  return new Request(url, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

describe('/api/admin/users/[id]/departments validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.from).mockReset()
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: true, error: null })
    ;(requireAuth as any).mockResolvedValue({ id: 'admin-user' })

    ;(loadCurrentOrganizationRoleAssignments as any).mockResolvedValue({ orgId: 'org-1', settings: {}, assignments: [{ scopeType: 'org', scopeId: 'org-1', permissions: ['org:write'] }] })

    ;(assertDepartmentInOrg as any).mockResolvedValue({ id: 'dept-a' })
  })

  it('没有当前组织用户写权限时，在解析 body 和访问业务表前拒绝 POST', async () => {

    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue(null)
    const json = vi.fn().mockResolvedValue({ department_ids: ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'] })

    const res = await POST({ json } as any, routeContext)

    expect(res.status).toBe(403)
    expect(loadCurrentOrganizationRoleAssignments).toHaveBeenCalledWith('admin-user')

    expect(json).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('拒绝空兼职部门列表且不访问数据库', async () => {
    const res = await POST(makeRequest({ department_ids: [] }), routeContext)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.error).toBe('请至少选择一个部门')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('拒绝删除请求缺少 department_id 且不访问数据库', async () => {
    const res = await DELETE(makeRequest({}), routeContext)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.error).toBe('请指定要删除的部门ID')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('兼职部门列表包含其他组织部门时不写入关联', async () => {
    const userLookup = makeQuery({
      data: {
        id: '00000000-0000-0000-0000-000000000001',
        display_name: '用户',
        primary_dept_id: null,
        org_id: 'org-1',
      },
      error: null,
    })
    const departmentLookup = makeQuery({
      data: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
      error: null,
    })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(userLookup)
      .mockReturnValueOnce(departmentLookup)

    const res = await POST(makeRequest({
      department_ids: [
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      ],
    }), routeContext)

    expect(res.status).toBe(400)
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
    expect(departmentLookup.eq).toHaveBeenCalledWith('org_id', 'org-1')
  })

  it('当前组织用户写权限只能写入已验证的当前组织兼职部门', async () => {
    const userLookup = makeQuery({
      data: {
        id: '00000000-0000-0000-0000-000000000001',
        display_name: '用户',
        primary_dept_id: null,
        org_id: 'org-1',
      },
      error: null,
    })
    const departmentIds = [
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    ]
    const departmentLookup = makeQuery({
      data: departmentIds.map((id) => ({ id })),
      error: null,
    })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(userLookup)
      .mockReturnValueOnce(departmentLookup)

    const res = await POST(makeRequest({ department_ids: departmentIds }), routeContext)

    expect(res.status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('admin_change_manual_department_membership_v1', {
      p_actor_id: 'admin-user', p_org_id: 'org-1', p_user_id: '00000000-0000-0000-0000-000000000001',
      p_department_ids: departmentIds, p_action: 'add',
    })
  })

  it('没有当前组织用户写权限时，不访问业务表并拒绝 DELETE', async () => {

    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue(null)

    const res = await DELETE({ method: 'DELETE' } as any, routeContext)

    expect(res.status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('拒绝删除其他组织部门关联', async () => {
    const userLookup = makeQuery({
      data: {
        id: '00000000-0000-0000-0000-000000000001',
        display_name: '用户',
        primary_dept_id: null,
        org_id: 'org-1',
      },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValueOnce(userLookup)
    ;(assertDepartmentInOrg as any).mockResolvedValue(null)
    const departmentId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

    const res = await DELETE(makeRequest(
      { department_id: departmentId },
      `https://example.test/api/admin/users/u-1/departments?department_id=${departmentId}`
    ), routeContext)
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_DEPARTMENT')
    expect(assertDepartmentInOrg).toHaveBeenCalledWith('org-1', departmentId)
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('删除当前组织兼职部门时使用事务服务', async () => {
    const userLookup = makeQuery({
      data: {
        id: '00000000-0000-0000-0000-000000000001',
        display_name: '用户',
        primary_dept_id: null,
        org_id: 'org-1',
      },
      error: null,
    })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(userLookup)
    const departmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    ;(assertDepartmentInOrg as any).mockResolvedValue({ id: departmentId })

    const res = await DELETE(makeRequest(
      { department_id: departmentId },
      `https://example.test/api/admin/users/u-1/departments?department_id=${departmentId}`
    ), routeContext)

    expect(res.status).toBe(200)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith('admin_change_manual_department_membership_v1', {
      p_actor_id: 'admin-user', p_org_id: 'org-1', p_user_id: '00000000-0000-0000-0000-000000000001',
      p_department_ids: [departmentId], p_action: 'remove',
    })
  })

  it.each([['add', POST], ['remove', DELETE]] as const)('返回台账授权限制 %s', async (action, handler) => {
    const departmentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const userLookup = makeQuery({
      data: { id: '00000000-0000-0000-0000-000000000001', primary_dept_id: null, org_id: 'org-1' }, error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValueOnce(userLookup)
      .mockReturnValueOnce(makeQuery({ data: [{ id: departmentId }], error: null }))
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: null, error: { code: '42501', details: 'DEPARTMENT_LEDGER_MEMBERSHIP_FORBIDDEN' },
    })

    const response = await handler(makeRequest(
      action === 'add' ? { department_ids: [departmentId] } : { department_id: departmentId },
    ), routeContext)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ code: 'DEPARTMENT_LEDGER_MEMBERSHIP_FORBIDDEN' })
  })

  it.each([['add', POST], ['remove', DELETE]] as const)('旧请求遇到真实变更必须先预览 %s', async (action, handler) => {
    const department = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(makeQuery({
      data: { id: '00000000-0000-0000-0000-000000000001', primary_dept_id: null, org_id: 'org-1' },
    })).mockReturnValueOnce(makeQuery({ data: [{ id: department }] }))
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null, error: { code: '40001', details: 'SECONDARY_DEPARTMENT_PREVIEW_REQUIRED' },
    } as any)
    const response = await handler(makeRequest(action === 'add' ? { department_ids: [department] } : { department_id: department }), routeContext)
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'SECONDARY_DEPARTMENT_PREVIEW_REQUIRED' })
  })

  it.each(['add', 'remove'])('saves one exact secondary change as the system administrator: %s', async operation => {
    const org = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const department = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const requestId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue({
      orgId: org, settings: {}, assignments: [{ scopeType: 'org', scopeId: org, roleCode: 'SUPER_ADMIN', permissions: ['*'] }],
    } as any)
    const applied = {
      status: 'applied', action: operation, affected_department_ids: [department], impact: {}, effective_at: '2026-11-27T15:00:00Z',
    }
    ;(supabaseAdmin.rpc as any).mockResolvedValueOnce({ data: applied, error: null })
    const response = await POST(makeRequest({
      action: 'save', expected_org_id: org, department_id: department, operation, request_id: requestId,
    }), routeContext)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(applied)
    expect(supabaseAdmin.rpc).toHaveBeenCalledExactlyOnceWith('save_member_secondary_department_change_v1', {
      p_org_id: org, p_actor_id: 'admin-user', p_user_id: '00000000-0000-0000-0000-000000000001',
      p_department_ids: [department], p_action: operation,
      p_override_choice: null, p_choice_id: null, p_request_id: requestId,
    })
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('exposes the scoped personal override choice and preserves a stale conflict', async () => {
    const org = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const department = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const choiceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue({
      orgId: org, settings: {}, assignments: [{ scopeType: 'org', scopeId: org, roleCode: 'SUPER_ADMIN', permissions: ['*'] }],
    } as any)
    const input = { action: 'save', expected_org_id: org, department_id: department, operation: 'remove' }
    const choice = {
      status: 'override_choice_required', choice_id: choiceId,
      impact: { affected_count: 1, retainable_count: 0, blocked_count: 1 },
    }
    ;(supabaseAdmin.rpc as any).mockResolvedValueOnce({ data: choice, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: '40001', details: 'SECONDARY_DEPARTMENT_STALE' } })
    expect(await (await POST(makeRequest(input), routeContext)).json()).toEqual(choice)
    expect((await POST(makeRequest({ ...input, choice_id: choiceId, override_choice: 'new_baseline' }), routeContext)).status).toBe(409)
    expect(supabaseAdmin.rpc).toHaveBeenLastCalledWith('save_member_secondary_department_change_v1', {
      p_org_id: org, p_actor_id: 'admin-user', p_user_id: '00000000-0000-0000-0000-000000000001',
      p_department_ids: [department], p_action: 'remove',
      p_override_choice: 'new_baseline', p_choice_id: choiceId, p_request_id: null,
    })
  })

  it('rejects stale organizations, unauthorized actors, mismatched choices and obsolete confirmation', async () => {
    const org = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    const department = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
    const choiceId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
    const save = { action: 'save', expected_org_id: org, department_id: department, operation: 'remove' }
    vi.mocked(loadCurrentOrganizationRoleAssignments).mockResolvedValue({
      orgId: org, settings: {}, assignments: [{ scopeType: 'org', scopeId: org, permissions: ['org:write'] }],
    } as any)
    expect((await POST(makeRequest(save), routeContext)).status).toBe(403)
    expect((await POST(makeRequest({ ...save, expected_org_id: department }), routeContext)).status).toBe(409)
    expect((await POST(makeRequest({ ...save, choice_id: choiceId }), routeContext)).status).toBe(400)
    const legacy = await POST(makeRequest({ action: 'confirm', expected_org_id: org, preview_id: choiceId }), routeContext)
    expect(legacy.status).toBe(409)
    expect(await legacy.json()).toMatchObject({ code: 'SECONDARY_DEPARTMENT_CLIENT_UPDATED' })
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })
})

function makeQuery(result: { data?: unknown; error?: unknown }) {
  const query: any = {}
  ;['select', 'upsert', 'delete', 'eq', 'in'].forEach((method) => {
    query[method] = vi.fn().mockReturnValue(query)
  })
  query.single = vi.fn().mockResolvedValue(result)
  query.maybeSingle = vi.fn().mockResolvedValue(result)
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return query
}
