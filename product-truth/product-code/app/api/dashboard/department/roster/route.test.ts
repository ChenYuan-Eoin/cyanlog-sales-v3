import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthError, requireAuth } from '@/lib/auth'
import { resolveDepartmentSpaceIds } from '@/lib/department-spaces'
import { supabaseAdmin } from '@/lib/supabase'
import { DepartmentAccessError, getDepartmentDashboardScope } from '../data'
import { GET } from './route'

vi.mock('@/lib/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/auth')>(),
  requireAuth: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({ supabaseAdmin: { from: vi.fn(), rpc: vi.fn() } }))
vi.mock('../data', async (importOriginal) => ({
  ...await importOriginal<typeof import('../data')>(),
  getDepartmentDashboardScope: vi.fn(),
}))

const actorId = '00000000-0000-4000-8000-000000000001'
const orgId = '00000000-0000-4000-8000-000000000002'
const sourceId = '00000000-0000-4000-8000-000000000003'
const firstBranch = '00000000-0000-4000-8000-000000000010'
const firstChild = '00000000-0000-4000-8000-000000000011'
const secondBranch = '00000000-0000-4000-8000-000000000012'
const hiddenBranch = '00000000-0000-4000-8000-000000000013'
const asOf = '2026-11-25T05:20:00.112398+00:00'
const source = { id: sourceId, system_org_id: orgId, status: 'active', provider: 'fxiaoke', last_successful_sync_at: asOf }
const url = 'https://example.test/api/dashboard/department/roster'
const sources = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  limit: vi.fn(),
}
const runs = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  is: vi.fn().mockReturnThis(),
  limit: vi.fn(),
}

function person(index: number, fields: Record<string, unknown> = {}) {
  const suffix = String(index).padStart(12, '0')
  return {
    id: `10000000-0000-4000-8000-${suffix}`,
    display_name: `成员 ${String(index).padStart(2, '0')}`,
    primary_dept_id: firstBranch,
    department_ids: [firstBranch],
    directory_identity_id: `20000000-0000-4000-8000-${suffix}`,
    directory_external_id: `external-${index}`,
    directory_source: 'fxiaoke',
    directory_status: 'active',
    membership_status: 'active',
    login_enabled: true,
    email: 'private@example.test',
    title: 'private job title',
    scoped_roles: [{ role: 'private role' }],
    ...fields,
  }
}

function respondWithPeople(...users: unknown[]) {
  vi.mocked(supabaseAdmin.rpc).mockResolvedValue({ data: { organization: { id: orgId }, users }, error: null } as never)
}

function get(params = '') {
  return GET(new NextRequest(`${url}${params}`))
}

async function expectUnavailable(response: Response, reason: string) {
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ status: 'unavailable', reason })
}

describe('department workspace roster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ id: actorId, email: null, phone: null, display_name: null })
    vi.mocked(supabaseAdmin.from).mockImplementation((table: string) => {
      if (table === 'organization_sources') return sources as never
      if (table === 'organization_directory_cutover_runs') return runs as never
      throw new Error(`Unexpected roster lookup: ${table}`)
    })
    const departmentSpaces = [
      { department_id: firstBranch, parent_department_id: null, name: '甲部' },
      { department_id: firstChild, parent_department_id: firstBranch, name: '甲一组' },
      { department_id: secondBranch, parent_department_id: null, name: '乙部' },
    ]
    vi.mocked(getDepartmentDashboardScope).mockImplementation(async (_userId, selection) => ({
      orgId, selection, departmentSpaces, allDepartments: departmentSpaces, grants: [], orgOversight: false,
      selectedDepartmentIds: resolveDepartmentSpaceIds(departmentSpaces, [firstBranch, secondBranch], selection.departmentId
        ? { departmentId: selection.departmentId, includeSubdepartments: selection.includeSubdepartments }
        : undefined),
    }))
    sources.limit.mockResolvedValue({ data: [source], error: null })
    runs.limit.mockResolvedValue({ data: [{ id: 'confirmed-cutover' }], error: null })
    respondWithPeople()
  })

  it('authorizes department selection before reading any privileged directory data', async () => {
    vi.mocked(requireAuth).mockRejectedValueOnce(new AuthError())
    expect((await get()).status).toBe(401)
    vi.mocked(getDepartmentDashboardScope).mockRejectedValueOnce(new DepartmentAccessError(hiddenBranch))
    expect((await get(`?departmentId=${hiddenBranch}`)).status).toBe(403)
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('projects only active synchronized identities within the selected subtree, including never-logged-in members', async () => {
    const invited = person(1, {
      membership_status: 'invited', login_enabled: false,
      primary_dept_id: firstChild, department_ids: [firstChild, secondBranch, hiddenBranch],
    })
    const repeat = { ...invited, primary_dept_id: null, department_ids: [firstBranch, firstChild] }
    const branchMember = person(2, { primary_dept_id: secondBranch, department_ids: [secondBranch] })
    respondWithPeople(
      branchMember, invited, repeat, person(3, { directory_identity_id: null, directory_external_id: null }),
      person(4, { directory_status: 'ended' }), person(5, { directory_status: 'suspended' }),
      person(6, { primary_dept_id: hiddenBranch, department_ids: [hiddenBranch] }),
      person(7, { primary_dept_id: firstBranch, department_ids: [] }),
    )
    const response = await get(`?departmentId=${firstBranch}&includeSubdepartments=true`)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toEqual({
      status: 'ready', organizationId: orgId, asOf, total: 2, page: 1, pageSize: 20,
      members: [
        { id: invited.id, displayName: invited.display_name, departmentIds: [firstBranch, firstChild] },
        { id: person(7).id, displayName: person(7).display_name, departmentIds: [firstBranch] },
      ],
    })
    expect(runs.eq).toHaveBeenCalledWith('target_source_id', sourceId)
    expect(runs.eq).toHaveBeenCalledWith('applied_at', asOf)
    expect(runs.is).toHaveBeenCalledWith('rolled_back_at', null)
    expect(supabaseAdmin.rpc).toHaveBeenCalledExactlyOnceWith('get_org_admin_directory_payload_v1', { p_org_id: orgId })
  })

  it('distinguishes the selected department from its children and returns a stable count across pages', async () => {
    respondWithPeople(
      ...Array.from({ length: 22 }, (_, index) => person(index + 1)).reverse(),
      person(23, { primary_dept_id: firstChild, department_ids: [firstChild] }),
      person(24, { primary_dept_id: secondBranch, department_ids: [secondBranch] }),
    )
    const page2 = await get(`?departmentId=${firstBranch}&includeSubdepartments=false&page=2`)
    const direct = await page2.json()
    expect(direct).toMatchObject({ status: 'ready', total: 22, page: 2, pageSize: 20 })
    expect(direct.members.map((member: { id: string }) => member.id)).toEqual([person(21).id, person(22).id])
    expect(await (await get(`?departmentId=${firstBranch}&page=3`)).json()).toMatchObject({
      status: 'ready', total: 23, page: 3, members: [],
    })
    expect(await (await get()).json()).toMatchObject({ status: 'ready', total: 24, page: 1 })
  })

  it.each(['?page=0', '?page=1.5', '?page=1&page=2', '?includeSubdepartments=yes', '?departmentId='])(
    'rejects invalid or ambiguous parameters %s',
    async (params) => {
      expect((await get(params)).status).toBe(400)
      expect(getDepartmentDashboardScope).not.toHaveBeenCalled()
    },
  )

  it('reports missing, ambiguous or disabled authority without opening the roster RPC', async () => {
    sources.limit
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({ data: [source, { ...source, status: 'disabled' }], error: null })
      .mockResolvedValueOnce({ data: [{ ...source, status: 'disabled' }], error: null })
      .mockResolvedValueOnce({ data: [{ ...source, last_successful_sync_at: null }], error: null })
    for (let request = 0; request < 4; request++) {
      await expectUnavailable(await get(), 'DIRECTORY_UNCONFIRMED')
    }
    expect(sources.in).toHaveBeenCalledWith('authority_scope->>directory', ['authoritative', 'true'])
    expect(sources.eq).not.toHaveBeenCalledWith('status', 'active')
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('reports an authority marker without a confirmed run as unavailable', async () => {
    runs.limit.mockResolvedValueOnce({ data: [], error: null })
    await expectUnavailable(await get(), 'DIRECTORY_UNCONFIRMED')
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('reports missing, malformed or wrong-organization RPC data without a legacy fallback or total', async () => {
    vi.mocked(supabaseAdmin.rpc)
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } } as never)
      .mockResolvedValueOnce({ data: { organization: { id: orgId }, users: [person(1, { department_ids: null })] }, error: null } as never)
      .mockResolvedValueOnce({ data: { organization: { id: sourceId }, users: [] }, error: null } as never)
    for (let request = 0; request < 3; request++) {
      await expectUnavailable(await get(), 'DIRECTORY_UNAVAILABLE')
    }
    expect(vi.mocked(supabaseAdmin.rpc).mock.calls.map(([name]) => name)).toEqual(Array(3).fill('get_org_admin_directory_payload_v1'))
  })

  it('discards the roster result if directory authority changed during the query', async () => {
    sources.limit
      .mockResolvedValueOnce({ data: [source], error: null })
      .mockResolvedValueOnce({ data: [{ ...source, last_successful_sync_at: '2026-11-25T05:29:00+00:00' }], error: null })
    respondWithPeople(person(1))
    await expectUnavailable(await get(), 'DIRECTORY_CHANGED')
  })

  it('reports conflicting stable identity rows without publishing a partial total', async () => {
    respondWithPeople(person(1), person(2, { directory_external_id: 'external-1' }))
    await expectUnavailable(await get(), 'DIRECTORY_UNAVAILABLE')
    respondWithPeople(person(1), person(2, { directory_identity_id: person(1).directory_identity_id }))
    await expectUnavailable(await get(), 'DIRECTORY_UNAVAILABLE')
  })
})
