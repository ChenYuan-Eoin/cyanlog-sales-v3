/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: mocks.from,
  },
}))

import { listAccessibleSalesSpaces, listAccessibleUserIds } from './scoped-access'

type QueryResult = {
  data: unknown
  error: unknown
}

type QueryDouble = {
  select: ReturnType<typeof vi.fn>
  eq: ReturnType<typeof vi.fn>
  in: ReturnType<typeof vi.fn>
  maybeSingle: ReturnType<typeof vi.fn>
  then: Promise<QueryResult>['then']
}

function queryDouble(result: QueryResult): QueryDouble {
  const query = {} as QueryDouble
  query.select = vi.fn(() => query)
  query.eq = vi.fn(() => query)
  query.in = vi.fn(() => query)
  query.maybeSingle = vi.fn(async () => result)
  query.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected)
  return query
}

function useQueriesByTable(queries: Record<string, QueryDouble[]>): void {
  const pending = new Map(
    Object.entries(queries).map(([table, tableQueries]) => [table, [...tableQueries]])
  )

  mocks.from.mockImplementation((table: string) => {
    const query = pending.get(table)?.shift()
    if (!query) {
      throw new Error(`Unexpected Supabase query for ${table}`)
    }
    return query
  })
}

const orgASpace = {
  id: 'space-a',
  org_id: 'org-a',
  name: '组织 A 空间',
  description: null,
  department_id: 'dept-a',
  owner_id: 'owner-a',
  active_opportunities: 1,
  pending_milestones: 2,
}

const orgBSpace = {
  ...orgASpace,
  id: 'space-b',
  org_id: 'org-b',
  name: '组织 B 空间',
  department_id: 'dept-b',
  owner_id: 'owner-b',
}

describe('sales space exact organization scope', () => {
  beforeEach(() => {
    mocks.from.mockReset()
  })

  it('组织 A 的空间列表不会合并用户在组织 B 的成员空间', async () => {
    const rolesQuery = queryDouble({ data: [], error: null })
    const membershipsQuery = queryDouble({
      data: [
        { space: orgASpace },
        // Canary: even if a test double or backend regression ignores the join filter,
        // the application layer must still reject the other organization.
        { space: orgBSpace },
      ],
      error: null,
    })

    useQueriesByTable({
      user_roles: [rolesQuery],
      sales_space_members: [membershipsQuery],
    })

    const access = await listAccessibleSalesSpaces('space-list-user-a', 'org-a')

    expect(access.spaces).toEqual([{
      id: 'space-a',
      name: '组织 A 空间',
      description: null,
      department_id: 'dept-a',
      owner_id: 'owner-a',
      active_opportunities: 1,
      pending_milestones: 2,
    }])
    expect(membershipsQuery.select).toHaveBeenCalledWith(expect.stringContaining('sales_spaces!inner'))
    expect(membershipsQuery.eq).toHaveBeenCalledWith('space.org_id', 'org-a')
  })

  it('默认组织 A 不会因组织 B 的空间成员关系扩大可访问用户集合', async () => {
    const defaultOrgQuery = queryDouble({ data: { org_id: 'org-a' }, error: null })
    const rolesQuery = queryDouble({ data: [], error: null })
    const membershipsQuery = queryDouble({
      data: [
        { space: { id: 'space-a', org_id: 'org-a' } },
        { space: { id: 'space-b', org_id: 'org-b' } },
      ],
      error: null,
    })
    const exactSpacesQuery = queryDouble({
      data: [
        { id: 'space-a', org_id: 'org-a', owner_id: 'owner-a' },
        { id: 'space-b', org_id: 'org-b', owner_id: 'owner-b' },
      ],
      error: null,
    })
    const spaceUsersQuery = queryDouble({
      data: [
        { user_id: 'member-a', space: { org_id: 'org-a' } },
        { user_id: 'member-b', space: { org_id: 'org-b' } },
      ],
      error: null,
    })

    useQueriesByTable({
      user_organizations: [defaultOrgQuery],
      user_roles: [rolesQuery],
      sales_space_members: [membershipsQuery, spaceUsersQuery],
      sales_spaces: [exactSpacesQuery],
    })

    const access = await listAccessibleUserIds('default-org-user-a')

    expect(access).toMatchObject({
      orgId: 'org-a',
      userIds: ['default-org-user-a', 'member-a', 'owner-a'],
    })
    expect(access.userIds).not.toContain('member-b')
    expect(access.userIds).not.toContain('owner-b')
    expect(defaultOrgQuery.eq).toHaveBeenCalledWith('is_default', true)
    expect(membershipsQuery.eq).toHaveBeenCalledWith('space.org_id', 'org-a')
    expect(exactSpacesQuery.eq).toHaveBeenCalledWith('org_id', 'org-a')
    expect(exactSpacesQuery.in).toHaveBeenCalledWith('id', ['space-a'])
    expect(spaceUsersQuery.eq).toHaveBeenCalledWith('space.org_id', 'org-a')
    expect(spaceUsersQuery.in).toHaveBeenCalledWith('space_id', ['space-a'])
  })
})
