/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/knowledge/access', () => ({
  canUseKnowledgePage: vi.fn(),
  fetchKnowledgePermissions: vi.fn(),
  getKnowledgeAccessContext: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  canManageOrg: vi.fn(),
}))

import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import {
  canUseKnowledgePage,
  fetchKnowledgePermissions,
  getKnowledgeAccessContext,
} from '@/lib/knowledge/access'
import { canManageOrg } from '@/lib/scoped-access'
import { GET } from './route'

function makeRequest(url = 'https://example.test/api/knowledge/pages'): any {
  return new Request(url)
}

function makeQuery(result: any) {
  const chain: any = {}
  ;['select', 'eq', 'ilike', 'order'].forEach((method) => {
    chain[method] = vi.fn().mockReturnValue(chain)
  })
  chain.range = vi.fn().mockResolvedValue(result)
  return chain
}

describe('GET /api/knowledge/pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'u-1' })
    ;(getKnowledgeAccessContext as any).mockResolvedValue({ orgId: 'org-1', assignments: [] })
    ;(canManageOrg as any).mockReturnValue(false)
    ;(fetchKnowledgePermissions as any).mockResolvedValue(new Map())
    ;(canUseKnowledgePage as any).mockReturnValue(true)
  })

  it('未登录 → 401', async () => {
    const authError = new Error('unauthorized')
    authError.name = 'AuthError'
    ;(requireAuth as any).mockRejectedValue(authError)

    const res = await GET(makeRequest())
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body.error).toBe('Unauthorized')
  })

  it('非法查询参数 → 400', async () => {
    const res = await GET(makeRequest('https://example.test/api/knowledge/pages?limit=999'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.code).toBe('INVALID_QUERY')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('返回分页列表并复用知识库权限过滤', async () => {
    const rows = [
      { id: 'p-1', org_id: 'org-1', title: '合同模板', created_by: 'other-user' },
      { id: 'p-2', org_id: 'org-1', title: '隐藏页面', created_by: 'other-user' },
    ]
    const query = makeQuery({ data: rows, error: null, count: 2 })
    ;(supabaseAdmin.from as any).mockReturnValue(query)
    ;(fetchKnowledgePermissions as any).mockResolvedValue(new Map([
      ['p-1', [{ page_id: 'p-1', principal_type: 'org', principal_id: 'org-1', permission: 'view' }]],
      ['p-2', []],
    ]))
    ;(canUseKnowledgePage as any).mockImplementation((page: any) => page.id === 'p-1')

    const res = await GET(makeRequest('https://example.test/api/knowledge/pages?limit=5&q=合同&type=doc'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual([rows[0]])
    expect(body.meta).toEqual({ total: 1, limit: 5, offset: 0 })
    expect(supabaseAdmin.from).toHaveBeenCalledWith('knowledge_pages')
    expect(query.select).toHaveBeenCalledWith(
      'id, org_id, title, type, parent_id, depth, path, sort_order, is_published, is_archived, created_by, created_at, updated_at, metadata',
      { count: 'exact' }
    )
    expect(query.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(query.eq).toHaveBeenCalledWith('is_archived', false)
    expect(query.eq).toHaveBeenCalledWith('type', 'doc')
    expect(query.ilike).toHaveBeenCalledWith('title', '%合同%')
    expect(query.range).toHaveBeenCalledWith(0, 4)
    expect(fetchKnowledgePermissions).toHaveBeenCalledWith(['p-1', 'p-2'])
  })

  it('组织管理员不重复读取页面权限', async () => {
    const rows = [{ id: 'p-1', org_id: 'org-1', title: '页面', created_by: 'other-user' }]
    const query = makeQuery({ data: rows, error: null, count: 1 })
    ;(supabaseAdmin.from as any).mockReturnValue(query)
    ;(canManageOrg as any).mockReturnValue(true)

    const res = await GET(makeRequest('https://example.test/api/knowledge/pages?offset=10'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data).toEqual(rows)
    expect(body.meta).toEqual({ total: 1, limit: 50, offset: 10 })
    expect(fetchKnowledgePermissions).not.toHaveBeenCalled()
    expect(canUseKnowledgePage).not.toHaveBeenCalled()
  })
})
