/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const QUOTE_ID = '11111111-1111-4111-8111-111111111111'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  canManageOrg: vi.fn().mockReturnValue(false),
  getDefaultOrgId: vi.fn().mockResolvedValue('org-1'),
  getUserScopedRoleAssignments: vi.fn().mockResolvedValue([]),
  listAccessibleUserIds: vi.fn().mockResolvedValue({ userIds: ['u1'] }),
}))

import { requireAuth } from '@/lib/auth'
import { getDefaultOrgId } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { DELETE, PUT } from './route'

function makeRequest(body: Record<string, unknown> = {}, method = 'PUT'): any {
  return {
    method,
    headers: new Headers(),
    json: async () => body,
  }
}

function makeMalformedRequest(): any {
  return {
    method: 'PUT',
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
  }
}

function makeQuotesChain(existingQuote: Record<string, unknown>, updateResult?: Record<string, unknown>) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: existingQuote,
      error: null,
    }),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: updateResult ?? existingQuote,
      error: null,
    }),
  }
  return chain
}

describe('PUT /api/quotes/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
  })

  it('无效 JSON → 400 且不查询组织和报价', async () => {
    const res = await PUT(makeMalformedRequest(), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })

    expect(res.status).toBe(400)
    expect(getDefaultOrgId).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('已批准报价不能再修改', async () => {
    const quotesChain = makeQuotesChain({
      id: QUOTE_ID,
      status: 'APPROVED',
      created_by: 'u1',
      org_id: 'org-1',
    })
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      expect(table).toBe('quotes')
      return quotesChain
    })

    const res = await PUT(makeRequest({ notes: 'try update approved quote' }), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })

    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe('QUOTE_LOCKED')
    expect(quotesChain.update).not.toHaveBeenCalled()
  })

  it('审批中的报价不能直接修改业务字段', async () => {
    const quotesChain = makeQuotesChain({
      id: QUOTE_ID,
      status: 'PENDING_APPROVAL',
      created_by: 'u1',
      org_id: 'org-1',
    })
    ;(supabaseAdmin.from as any).mockImplementation(() => quotesChain)

    const res = await PUT(makeRequest({ customer_name: '新客户名' }), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })

    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe('INVALID_STATUS')
    expect(quotesChain.update).not.toHaveBeenCalled()
  })

  it('草稿报价不能直接跳到已批准', async () => {
    const quotesChain = makeQuotesChain({
      id: QUOTE_ID,
      status: 'DRAFT',
      created_by: 'u1',
      org_id: 'org-1',
    })
    ;(supabaseAdmin.from as any).mockImplementation(() => quotesChain)

    const res = await PUT(makeRequest({ status: 'APPROVED' }), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })

    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe('INVALID_STATUS')
    expect(quotesChain.update).not.toHaveBeenCalled()
  })

  it('草稿报价可以提交审批', async () => {
    const quotesChain = makeQuotesChain(
      {
        id: QUOTE_ID,
        status: 'DRAFT',
        created_by: 'u1',
        org_id: 'org-1',
      },
      {
        id: QUOTE_ID,
        status: 'PENDING_APPROVAL',
        created_by: 'u1',
        org_id: 'org-1',
        customer_name: '测试客户',
        customer_contact: null,
        subtotal: 1000,
        discount_amount: 0,
        discount_rate: 0,
        tax_amount: 0,
        tax_rate: 0,
        total_amount: 1000,
        valid_until: null,
        created_at: '2026-06-09T00:00:00.000Z',
        updated_at: '2026-06-09T00:00:00.000Z',
      }
    )
    ;(supabaseAdmin.from as any).mockImplementation(() => quotesChain)

    const res = await PUT(makeRequest({ status: 'PENDING_APPROVAL' }), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })

    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.status).toBe('PENDING_APPROVAL')
    expect(quotesChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'PENDING_APPROVAL' })
    )
  })
})

describe('DELETE /api/quotes/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'u1' })
  })

  it('审批中的报价不能删除', async () => {
    const quotesChain = makeQuotesChain({
      id: QUOTE_ID,
      status: 'PENDING_APPROVAL',
      created_by: 'u1',
      org_id: 'org-1',
    })
    ;(supabaseAdmin.from as any).mockImplementation(() => quotesChain)

    const res = await DELETE(makeRequest({}, 'DELETE'), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })

    const body = await res.json()
    expect(res.status).toBe(409)
    expect(body.code).toBe('INVALID_STATUS')
    expect(quotesChain.delete).not.toHaveBeenCalled()
  })

  it('草稿报价可以删除', async () => {
    const quotesChain = makeQuotesChain({
      id: QUOTE_ID,
      status: 'DRAFT',
      created_by: 'u1',
      org_id: 'org-1',
    })
    ;(supabaseAdmin.from as any).mockImplementation(() => quotesChain)

    const res = await DELETE(makeRequest({}, 'DELETE'), {
      params: Promise.resolve({ id: QUOTE_ID }),
    })

    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(quotesChain.delete).toHaveBeenCalled()
  })
})
