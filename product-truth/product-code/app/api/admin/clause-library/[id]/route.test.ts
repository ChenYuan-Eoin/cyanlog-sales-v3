/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  getDefaultOrgId: vi.fn(),
}))

vi.mock('@/lib/configs/access', () => ({
  userHasFreshOrgConfigAccess: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
import { userHasFreshOrgConfigAccess } from '@/lib/configs/access'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { DELETE, PATCH } from './route'

function makeMalformedRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'PATCH',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeJsonRequest(body: unknown): any {
  return {
    json: async () => body,
    method: 'PATCH',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('PATCH /api/admin/clause-library/[id] validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
    ;(userHasFreshOrgConfigAccess as any).mockResolvedValue(true)
  })

  it('没有当前组织 config:write 时拒绝修改，且不解析请求或访问数据库', async () => {
    ;(userHasFreshOrgConfigAccess as any).mockResolvedValue(false)
    const json = vi.fn().mockResolvedValue({ name: '修改后的条款' })

    const res = await PATCH({
      json,
      method: 'PATCH',
      headers: new Headers({ 'content-type': 'application/json' }),
    } as any, {
      params: Promise.resolve({ id: 'clause-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('NO_PERMISSION')
    expect(userHasFreshOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'write')
    expect(json).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('无效 JSON 返回参数错误且不访问数据库', async () => {
    const res = await PATCH(makeMalformedRequest(), {
      params: Promise.resolve({ id: 'clause-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_FIELDS')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('立场值错误返回参数错误且不访问数据库', async () => {
    const res = await PATCH(makeJsonRequest({ stance: 'invalid' }), {
      params: Promise.resolve({ id: 'clause-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_STANCE')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('系统条款即使先被查到也不可修改', async () => {
    const lookup = makeLookupQuery({ is_system: true, org_id: null })
    ;(supabaseAdmin.from as any).mockReturnValueOnce(lookup)

    const res = await PATCH(makeJsonRequest({ name: '修改后的条款' }), {
      params: Promise.resolve({ id: 'system-clause' }),
    })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('SYSTEM_PROTECTED')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('其他组织条款即使先被查到也不可修改', async () => {
    const lookup = makeLookupQuery({ is_system: false, org_id: 'org-2' })
    ;(supabaseAdmin.from as any).mockReturnValueOnce(lookup)

    const res = await PATCH(makeJsonRequest({ name: '修改后的条款' }), {
      params: Promise.resolve({ id: 'foreign-clause' }),
    })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('NO_PERMISSION')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('当前组织 config:write 修改时，最终更新仍约束 org_id 与 is_system', async () => {
    const lookup = makeLookupQuery({ is_system: false, org_id: 'org-1' })
    const mutation = makeUpdateQuery({ id: 'clause-1', name: '修改后的条款' })
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(lookup)
      .mockReturnValueOnce(mutation.query)

    const res = await PATCH(makeJsonRequest({ name: '修改后的条款' }), {
      params: Promise.resolve({ id: 'clause-1' }),
    })

    expect(res.status).toBe(200)
    expect(mutation.update).toHaveBeenCalledWith(expect.objectContaining({ name: '修改后的条款' }))
    expect(mutation.eq).toHaveBeenCalledWith('id', 'clause-1')
    expect(mutation.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(mutation.eq).toHaveBeenCalledWith('is_system', false)
  })
})

describe('DELETE /api/admin/clause-library/[id] authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
    ;(getDefaultOrgId as any).mockResolvedValue('org-1')
    ;(userHasFreshOrgConfigAccess as any).mockResolvedValue(true)
  })

  it('没有当前组织 config:write 时拒绝删除且不访问数据库', async () => {
    ;(userHasFreshOrgConfigAccess as any).mockResolvedValue(false)

    const res = await DELETE({ method: 'DELETE' } as any, {
      params: Promise.resolve({ id: 'clause-1' }),
    })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('NO_PERMISSION')
    expect(userHasFreshOrgConfigAccess).toHaveBeenCalledWith('user-1', 'org-1', 'write')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('系统条款不可删除', async () => {
    const lookup = makeLookupQuery({ is_system: true, org_id: null })
    ;(supabaseAdmin.from as any).mockReturnValueOnce(lookup)

    const res = await DELETE({ method: 'DELETE' } as any, {
      params: Promise.resolve({ id: 'system-clause' }),
    })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('SYSTEM_PROTECTED')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('其他组织条款不可删除', async () => {
    const lookup = makeLookupQuery({ is_system: false, org_id: 'org-2' })
    ;(supabaseAdmin.from as any).mockReturnValueOnce(lookup)

    const res = await DELETE({ method: 'DELETE' } as any, {
      params: Promise.resolve({ id: 'foreign-clause' }),
    })
    const body = await res.json()

    expect(res.status).toBe(403)
    expect(body.code).toBe('NO_PERMISSION')
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('当前组织 config:write 删除时，最终删除仍约束 org_id 与 is_system', async () => {
    const lookup = makeLookupQuery({ is_system: false, org_id: 'org-1' })
    const mutation = makeDeleteQuery()
    ;(supabaseAdmin.from as any)
      .mockReturnValueOnce(lookup)
      .mockReturnValueOnce(mutation.query)

    const res = await DELETE({ method: 'DELETE' } as any, {
      params: Promise.resolve({ id: 'clause-1' }),
    })

    expect(res.status).toBe(200)
    expect(mutation.deleteFn).toHaveBeenCalledOnce()
    expect(mutation.eq).toHaveBeenCalledWith('id', 'clause-1')
    expect(mutation.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(mutation.eq).toHaveBeenCalledWith('is_system', false)
  })
})

function makeLookupQuery(row: { is_system: boolean; org_id: string | null }) {
  const query: any = {}
  query.select = vi.fn().mockReturnValue(query)
  query.eq = vi.fn().mockReturnValue(query)
  query.single = vi.fn().mockResolvedValue({ data: row, error: null })
  return query
}

function makeUpdateQuery(row: Record<string, unknown>) {
  const query: any = {}
  const update = vi.fn().mockReturnValue(query)
  const eq = vi.fn().mockReturnValue(query)
  query.update = update
  query.eq = eq
  query.select = vi.fn().mockReturnValue(query)
  query.single = vi.fn().mockResolvedValue({ data: row, error: null })
  return { query, update, eq }
}

function makeDeleteQuery() {
  const query: any = {}
  const deleteFn = vi.fn().mockReturnValue(query)
  const eq = vi.fn().mockReturnValue(query)
  query.delete = deleteFn
  query.eq = eq
  query.then = (resolve: (value: unknown) => unknown) => resolve({ error: null })
  return { query, deleteFn, eq }
}
