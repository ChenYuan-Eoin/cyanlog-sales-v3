/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/scoped-access', () => ({
  getAccessibleContract: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
  },
}))

import { requireAuth } from '@/lib/auth'
import { getAccessibleContract } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

function makeJsonRequest(body: unknown): any {
  return {
    json: async () => body,
    method: 'POST',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

describe('POST /api/contracts/[id]/asks/generate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1', email: 'user@example.com' })
    ;(getAccessibleContract as any).mockResolvedValue({
      contract: { id: 'contract-1' },
      orgId: 'org-1',
      userIds: ['user-1'],
    })
  })

  it('creates ASK negotiation tasks from open red/yellow risk cards', async () => {
    const insertedPayloads: any[] = []
    const contractUpdates: any[] = []
    let askItemsCall = 0

    const existingAskQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: [], error: null }),
    }
    const riskCardQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          {
            clause_ref: '第 3 条',
            title: '付款周期过长',
            description: '付款期限为 90 天',
            suggestion: '改为 30 天内付款',
            level: 'red',
          },
          {
            clause_ref: '第 6 条',
            title: '验收标准缺失',
            description: '未约定验收标准',
            suggestion: '补充验收标准',
            level: 'yellow',
          },
        ],
        error: null,
      }),
    }
    const askInsertQuery = {
      insert: vi.fn((payload) => {
        insertedPayloads.push(payload)
        return askInsertQuery
      }),
      select: vi.fn().mockResolvedValue({
        data: [
          { id: 'ask-1', ask_code: 'ASK-001', status: 'pending' },
          { id: 'ask-2', ask_code: 'ASK-002', status: 'pending' },
        ],
        error: null,
      }),
    }
    const contractsQuery = {
      update: vi.fn((payload) => {
        contractUpdates.push(payload)
        return contractsQuery
      }),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockResolvedValue({ data: null, error: null }),
    }

    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'ask_items') {
        askItemsCall += 1
        return askItemsCall === 1 ? existingAskQuery : askInsertQuery
      }
      if (table === 'contract_risk_cards') return riskCardQuery
      if (table === 'contracts') return contractsQuery
      throw new Error(`Unexpected table ${table}`)
    })

    const response = await POST(makeJsonRequest({}), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data).toHaveLength(2)
    expect(insertedPayloads[0]).toEqual([
      expect.objectContaining({
        contract_id: 'contract-1',
        ask_code: 'ASK-001',
        clause_ref: '第 3 条',
        risk_name: '付款周期过长',
        initial_level: 'red',
        question_type: 'financial',
        required_roles: ['finance'],
        trigger_user_id: 'user-1',
      }),
      expect.objectContaining({
        ask_code: 'ASK-002',
        risk_name: '验收标准缺失',
        initial_level: 'yellow',
        question_type: 'technical',
        required_roles: ['technical'],
      }),
    ])
    expect(contractUpdates[0]).toEqual({
      status: 'ASK_GENERATED',
      asks_count: 2,
    })
  })

  it('reuses existing ASK items and does not duplicate negotiation tasks', async () => {
    const existingAskQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [{ id: 'ask-existing', ask_code: 'ASK-001', status: 'pending' }],
        error: null,
      }),
    }

    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'ask_items') return existingAskQuery
      throw new Error(`Unexpected table ${table}`)
    })

    const response = await POST(makeJsonRequest({}), {
      params: Promise.resolve({ id: 'contract-1' }),
    })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.data).toEqual([{ id: 'ask-existing', ask_code: 'ASK-001', status: 'pending' }])
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })
})
