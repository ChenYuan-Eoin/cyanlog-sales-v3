/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import { syncPrimaryDepartmentMembership } from './org-membership'

const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const orgA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const orgB = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const oldDeptA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const newDeptA = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const dirtyDeptB = 'ffffffff-ffff-4fff-8fff-ffffffffffff'

describe('syncPrimaryDepartmentMembership organization isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('权威用户不存在时失败且没有任何部门读写', async () => {
    const userLookup = makeQuery({ data: null, error: null })
    ;(supabaseAdmin.from as any).mockReturnValueOnce(userLookup)

    await expect(syncPrimaryDepartmentMembership(userId, null, orgA))
      .rejects.toThrow('PRIMARY_DEPARTMENT_USER_NOT_FOUND')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('拒绝调用方组织与权威用户组织不一致，且不读取或写入部门关联', async () => {
    const userLookup = makeQuery({
      data: { id: userId, org_id: orgA, primary_dept_id: newDeptA },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValueOnce(userLookup)

    await expect(syncPrimaryDepartmentMembership(userId, newDeptA, orgB))
      .rejects.toThrow('PRIMARY_DEPARTMENT_ORG_MISMATCH')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('拒绝参数与 users.primary_dept_id 不一致，且没有副作用', async () => {
    const userLookup = makeQuery({
      data: { id: userId, org_id: orgA, primary_dept_id: oldDeptA },
      error: null,
    })
    ;(supabaseAdmin.from as any).mockReturnValueOnce(userLookup)

    await expect(syncPrimaryDepartmentMembership(userId, newDeptA, orgA))
      .rejects.toThrow('PRIMARY_DEPARTMENT_STATE_MISMATCH')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('拒绝不属于权威用户组织的新主部门，且不读取或写入关联', async () => {
    const userLookup = makeQuery({
      data: { id: userId, org_id: orgA, primary_dept_id: dirtyDeptB },
      error: null,
    })
    const targetDepartmentLookup = makeQuery({ data: null, error: null })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(userLookup)
      .mockReturnValueOnce(targetDepartmentLookup)

    await expect(syncPrimaryDepartmentMembership(userId, dirtyDeptB, orgA))
      .rejects.toThrow('PRIMARY_DEPARTMENT_INVALID')
    expect(targetDepartmentLookup.eq).toHaveBeenCalledWith('id', dirtyDeptB)
    expect(targetDepartmentLookup.eq).toHaveBeenCalledWith('org_id', orgA)
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(2)
  })

  it('org A 切换主部门时只删除 org A 旧关联，不影响 org B 脏关联', async () => {
    const userLookup = makeQuery({
      data: { id: userId, org_id: orgA, primary_dept_id: newDeptA },
      error: null,
    })
    const targetDepartmentLookup = makeQuery({
      data: { id: newDeptA, parent_id: null, path: `/${newDeptA}/` },
      error: null,
    })
    const primaryMembershipLookup = makeQuery({
      data: [
        { department_id: oldDeptA },
        { department_id: dirtyDeptB },
        { department_id: newDeptA },
      ],
      error: null,
    })
    const currentOrgDepartmentLookup = makeQuery({
      data: [{ id: oldDeptA }, { id: newDeptA }],
      error: null,
    })
    const deleteOldPrimary = makeQuery({ data: null, error: null })
    const upsertNewPrimary = makeQuery({ data: null, error: null })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(userLookup)
      .mockReturnValueOnce(targetDepartmentLookup)
      .mockReturnValueOnce(primaryMembershipLookup)
      .mockReturnValueOnce(currentOrgDepartmentLookup)
      .mockReturnValueOnce(deleteOldPrimary)
      .mockReturnValueOnce(upsertNewPrimary)

    await syncPrimaryDepartmentMembership(userId, newDeptA, orgA)

    expect(currentOrgDepartmentLookup.eq).toHaveBeenCalledWith('org_id', orgA)
    expect(currentOrgDepartmentLookup.in).toHaveBeenCalledWith(
      'id',
      [oldDeptA, dirtyDeptB, newDeptA]
    )
    expect(deleteOldPrimary.in).toHaveBeenCalledWith('department_id', [oldDeptA])
    expect(deleteOldPrimary.in).not.toHaveBeenCalledWith(
      'department_id',
      expect.arrayContaining([dirtyDeptB])
    )
    expect(upsertNewPrimary.upsert).toHaveBeenCalledWith(
      {
        user_id: userId,
        department_id: newDeptA,
        is_primary: true,
      },
      { onConflict: 'user_id,department_id' }
    )
  })

  it('清空 org A 主部门时仍保留 org B 脏关联', async () => {
    const userLookup = makeQuery({
      data: { id: userId, org_id: orgA, primary_dept_id: null },
      error: null,
    })
    const primaryMembershipLookup = makeQuery({
      data: [{ department_id: oldDeptA }, { department_id: dirtyDeptB }],
      error: null,
    })
    const currentOrgDepartmentLookup = makeQuery({ data: [{ id: oldDeptA }], error: null })
    const deleteOldPrimary = makeQuery({ data: null, error: null })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(userLookup)
      .mockReturnValueOnce(primaryMembershipLookup)
      .mockReturnValueOnce(currentOrgDepartmentLookup)
      .mockReturnValueOnce(deleteOldPrimary)

    await syncPrimaryDepartmentMembership(userId, null, orgA)

    expect(deleteOldPrimary.in).toHaveBeenCalledWith('department_id', [oldDeptA])
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(4)
  })

  it('删除旧主部门失败时不继续 upsert 新主部门', async () => {
    const userLookup = makeQuery({
      data: { id: userId, org_id: orgA, primary_dept_id: newDeptA },
      error: null,
    })
    const targetDepartmentLookup = makeQuery({
      data: { id: newDeptA, parent_id: null, path: `/${newDeptA}/` },
      error: null,
    })
    const primaryMembershipLookup = makeQuery({
      data: [{ department_id: oldDeptA }],
      error: null,
    })
    const currentOrgDepartmentLookup = makeQuery({ data: [{ id: oldDeptA }], error: null })
    const deleteOldPrimary = makeQuery({ data: null, error: { message: 'delete failed' } })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(userLookup)
      .mockReturnValueOnce(targetDepartmentLookup)
      .mockReturnValueOnce(primaryMembershipLookup)
      .mockReturnValueOnce(currentOrgDepartmentLookup)
      .mockReturnValueOnce(deleteOldPrimary)

    await expect(syncPrimaryDepartmentMembership(userId, newDeptA, orgA))
      .rejects.toThrow('PRIMARY_DEPARTMENT_SYNC_FAILED')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(5)
  })
})

function makeQuery(result: { data?: unknown; error?: unknown }) {
  const query: any = {}
  ;['select', 'delete', 'upsert', 'eq', 'in'].forEach((method) => {
    query[method] = vi.fn().mockReturnValue(query)
  })
  query.maybeSingle = vi.fn().mockResolvedValue(result)
  query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => (
    Promise.resolve(result).then(resolve, reject)
  )
  return query
}
