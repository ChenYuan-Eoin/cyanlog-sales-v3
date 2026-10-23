/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))

vi.mock('@/lib/scoped-access', () => ({
  canMutateOrgUsers: vi.fn(),
  getDefaultOrgId: vi.fn(),
  getFreshUserScopedRoleAssignments: vi.fn(),
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
import { userHasOrgRoleCode } from '@/lib/admin/org-role-authority'
import { supabaseAdmin } from '@/lib/supabase'
import { PATCH } from './route'

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const targetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const managerId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const orgId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const routeContext: any = {
  params: Promise.resolve({ id: targetId }),
}

function makeRequest(reportToUserId: unknown): any {
  return new Request(`https://example.test/api/admin/users/${targetId}/report-to`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ report_to_user_id: reportToUserId }),
  })
}

function makeQuery(result: { data?: unknown; error?: unknown }) {
  const query: any = {}
  ;['select', 'update', 'eq'].forEach((method) => {
    query[method] = vi.fn().mockReturnValue(query)
  })
  query.maybeSingle = vi.fn().mockResolvedValue(result)
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return query
}

describe('/api/admin/users/[id]/report-to', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: actorId })
    ;(getDefaultOrgId as any).mockResolvedValue(orgId)
    ;(getFreshUserScopedRoleAssignments as any).mockResolvedValue([
      { scopeType: 'org', scopeId: orgId, roleCode: 'ADMIN', permissions: ['user:write'] },
    ])
    ;(canMutateOrgUsers as any).mockReturnValue(true)
    ;(userHasOrgRoleCode as any).mockResolvedValue(false)
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: true, error: null })
  })

  it('拒绝非法直属上级 ID 且不读写目标用户', async () => {
    const response = await PATCH(makeRequest('not-a-uuid'), routeContext)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.error).toBe('直属上级 ID 格式不正确')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('只有 SALES_OPS 时拒绝修改汇报关系', async () => {
    const assignments = [
      { scopeType: 'org', scopeId: orgId, roleCode: 'SALES_OPS', permissions: [] },
    ]
    ;(getFreshUserScopedRoleAssignments as any).mockResolvedValue(assignments)
    ;(canMutateOrgUsers as any).mockReturnValue(false)

    const response = await PATCH(makeRequest(managerId), routeContext)

    expect(response.status).toBe(403)
    expect(getFreshUserScopedRoleAssignments).toHaveBeenCalledWith(actorId)
    expect(canMutateOrgUsers).toHaveBeenCalledWith(assignments, orgId)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('目标用户必须属于当前组织', async () => {
    const targetLookup = makeQuery({ data: null, error: null })
    ;(supabaseAdmin.from as any).mockReturnValue(targetLookup)

    const response = await PATCH(makeRequest(managerId), routeContext)

    expect(response.status).toBe(404)
    expect(targetLookup.eq).toHaveBeenCalledWith('id', targetId)
    expect(targetLookup.eq).toHaveBeenCalledWith('org_id', orgId)
  })

  it('不允许修改当前组织 SUPER_ADMIN 的汇报关系', async () => {
    const targetLookup = makeQuery({
      data: { id: targetId, display_name: '平台根管理员', org_id: orgId },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValue(targetLookup)
    ;(userHasOrgRoleCode as any).mockResolvedValue(true)

    const response = await PATCH(makeRequest(managerId), routeContext)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('PROTECTED_ROLE_MUTATION_FORBIDDEN')
    expect(userHasOrgRoleCode).toHaveBeenCalledWith(targetId, orgId, 'SUPER_ADMIN')
    expect(targetLookup.update).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('拒绝其他组织的汇报对象且不写入', async () => {
    const targetLookup = makeQuery({
      data: { id: targetId, display_name: '普通用户', org_id: orgId },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValueOnce(targetLookup)
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: null,
      error: { code: '23514', message: 'invalid reporting manager' },
    })

    const response = await PATCH(makeRequest(managerId), routeContext)

    expect(response.status).toBe(400)
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'admin_set_reporting_manager_v1',
      expect.objectContaining({
        p_actor_id: actorId,
        p_org_id: orgId,
        p_user_id: targetId,
        p_manager_user_id: managerId,
      }),
    )
  })

  it('以单一事务命令校验层级并写入审计事件', async () => {
    const targetLookup = makeQuery({
      data: { id: targetId, display_name: '普通用户', org_id: orgId },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValueOnce(targetLookup)

    const response = await PATCH(makeRequest(managerId), routeContext)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toEqual({ id: targetId, report_to_user_id: managerId })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'admin_set_reporting_manager_v1',
      expect.objectContaining({
        p_actor_id: actorId,
        p_org_id: orgId,
        p_user_id: targetId,
        p_manager_user_id: managerId,
      }),
    )
  })
})
