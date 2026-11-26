/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))

vi.mock('@/lib/org-role-permissions', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/org-role-permissions')>(),
  loadCurrentOrganizationRoleAssignments: vi.fn(),
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
import { loadCurrentOrganizationRoleAssignments } from '@/lib/org-role-permissions'
import { userHasOrgRoleCode } from '@/lib/admin/org-role-authority'
import { supabaseAdmin } from '@/lib/supabase'
import { PATCH } from './route'

const actorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const targetId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const orgId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

const routeContext: any = {
  params: Promise.resolve({ id: targetId }),
}

function makeRequest(body: unknown): any {
  return new Request(`https://example.test/api/admin/users/${targetId}/login-enabled`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeLookup(result: { data?: unknown; error?: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
}

describe('/api/admin/users/[id]/login-enabled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: actorId })

    ;(loadCurrentOrganizationRoleAssignments as any).mockResolvedValue({ orgId: orgId, settings: {}, assignments: [
      { scopeType: 'org', scopeId: orgId, roleCode: 'ADMIN', permissions: ['user:write'] },
    ] })

    ;(userHasOrgRoleCode as any).mockResolvedValue(false)
    ;(supabaseAdmin.rpc as any).mockResolvedValue({ data: true, error: null })
  })

  it('拒绝非布尔 login_enabled 且不读写目标用户', async () => {
    const response = await PATCH(makeRequest({ login_enabled: 'false' }), routeContext)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body).toEqual({
      code: 'VALIDATION_ERROR',
      error: 'login_enabled 必须为布尔值',
    })
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('只有 user:view 时拒绝修改登录状态', async () => {
    const assignments = [
      { scopeType: 'org', scopeId: orgId, roleCode: 'VIEWER', permissions: ['user:view'] },
    ]
    ;(loadCurrentOrganizationRoleAssignments as any).mockResolvedValue({ orgId: orgId, settings: {}, assignments: assignments })

    const response = await PATCH(makeRequest({ login_enabled: false }), routeContext)

    expect(response.status).toBe(403)
    expect(loadCurrentOrganizationRoleAssignments).toHaveBeenCalledWith(actorId)

    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('不允许修改自己的登录状态', async () => {
    ;(requireAuth as any).mockResolvedValue({ id: targetId })

    const response = await PATCH(makeRequest({ login_enabled: false }), routeContext)

    expect(response.status).toBe(400)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('目标用户必须属于当前组织', async () => {
    const lookup = makeLookup({ data: null, error: null })
    ;(supabaseAdmin.from as any).mockReturnValue(lookup)

    const response = await PATCH(makeRequest({ login_enabled: false }), routeContext)

    expect(response.status).toBe(404)
    expect(lookup.eq).toHaveBeenCalledWith('id', targetId)
    expect(lookup.eq).toHaveBeenCalledWith('org_id', orgId)
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('禁止修改当前组织 SUPER_ADMIN 的登录状态', async () => {
    const lookup = makeLookup({
      data: { id: targetId, display_name: '平台根管理员', org_id: orgId },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValue(lookup)
    ;(userHasOrgRoleCode as any).mockResolvedValue(true)

    const response = await PATCH(makeRequest({ login_enabled: false }), routeContext)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.code).toBe('PROTECTED_ROLE_MUTATION_FORBIDDEN')
    expect(userHasOrgRoleCode).toHaveBeenCalledWith(targetId, orgId, 'SUPER_ADMIN')
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('禁止登录通过原子 RPC 变更状态并撤销会话', async () => {
    const lookup = makeLookup({
      data: { id: targetId, display_name: '普通用户', org_id: orgId },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValue(lookup)

    const response = await PATCH(makeRequest({ login_enabled: false }), routeContext)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data.login_enabled).toBe(false)
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'admin_set_account_state_v1',
      {
        p_actor_id: actorId,
        p_org_id: orgId,
        p_user_id: targetId,
        p_status: null,
        p_login_enabled: false,
        p_reason: 'tenant administrator login state update',
        p_request_id: null,
      }
    )
  })

  it('重新允许登录也必须走同一 RPC，不允许历史 token 复活', async () => {
    const lookup = makeLookup({
      data: { id: targetId, display_name: '普通用户', org_id: orgId },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValue(lookup)

    const response = await PATCH(makeRequest({ login_enabled: true }), routeContext)

    expect(response.status).toBe(200)
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'admin_set_account_state_v1',
      {
        p_actor_id: actorId,
        p_org_id: orgId,
        p_user_id: targetId,
        p_status: null,
        p_login_enabled: true,
        p_reason: 'tenant administrator login state update',
        p_request_id: null,
      }
    )
  })

  it('RPC 失败时返回 500，不回退到分步更新', async () => {
    const lookup = makeLookup({
      data: { id: targetId, display_name: '普通用户', org_id: orgId },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValue(lookup)
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: null,
      error: { message: 'token revoke failed' },
    })

    const response = await PATCH(makeRequest({ login_enabled: false }), routeContext)

    expect(response.status).toBe(500)
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })
})
