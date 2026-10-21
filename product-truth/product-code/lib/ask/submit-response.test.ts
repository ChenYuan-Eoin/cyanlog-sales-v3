/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/scoped-access', () => ({
  getAccessibleContract: vi.fn(),
  getOrgRoleCodes: (assignments: Array<{ roleCode?: string }>) => (
    assignments.map((assignment) => assignment.roleCode).filter(Boolean)
  ),
  getOrgAuthorizationRoleCodes: (assignments: Array<{ roleCode?: string; permissionsOverridden?: boolean }>) => (
    assignments.filter((assignment) => !assignment.permissionsOverridden)
      .map((assignment) => assignment.roleCode).filter(Boolean)
  ),
  getOrgPermissions: (assignments: Array<{ permissions?: string[] }>) => (
    assignments.flatMap((assignment) => assignment.permissions || [])
  ),
  canReviewContracts: (assignments: Array<{ permissions?: string[] }>) => (
    assignments.some((assignment) => assignment.permissions?.includes('contract:review'))
  ),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

vi.mock('@/lib/contracts/current-review-binding', () => ({
  resolveCurrentReviewArtifactBinding: vi.fn(),
}))

import { getAccessibleContract } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { resolveCurrentReviewArtifactBinding } from '@/lib/contracts/current-review-binding'
import { submitAskResponse } from './submit-response'

function makeAskLookup(overrides: Record<string, unknown> = {}) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: {
        id: 'ask-1',
        contract_id: 'contract-1',
        review_id: 'review-1',
        contract_version_id: 'version-1',
        binding_state: 'bound',
        status: 'pending',
        required_roles: ['sales'],
        response_id: null,
        ...overrides,
      },
      error: null,
    }),
  }
}

describe('submitAskResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getAccessibleContract as any).mockResolvedValue({
      contract: { id: 'contract-1', current_version_id: 'version-1' },
      assignments: [{ roleCode: 'ADMIN', permissions: ['contract:review'] }],
      orgId: 'org-1',
    })
    ;(resolveCurrentReviewArtifactBinding as any).mockResolvedValue({
      contractId: 'contract-1',
      reviewId: 'review-1',
      contractVersionId: 'version-1',
      reviewStatus: 'COMPLETED',
    })
  })

  it('rejects an ASK from an older review of the current source version', async () => {
    const askLookupQuery = makeAskLookup({ id: 'ask-old', review_id: 'review-old' })
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'ask_items') return askLookupQuery
      throw new Error(`Unexpected table ${table}`)
    })

    const response = await submitAskResponse({
      askId: 'ask-old',
      contractId: 'contract-1',
      body: { response_text: '不应写入旧审核' },
      user: {
        id: 'user-1',
        email: 'user@example.com',
        display_name: '测试用户',
      } as any,
    })
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error.message).toContain('较早的审核记录')
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('commits the response and current report through one aggregate RPC', async () => {
    const askLookupQuery = makeAskLookup()
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'ask_items') return askLookupQuery
      throw new Error(`Unexpected table ${table}`)
    })
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: [{
        response: {
          id: 'response-1',
          ask_id: 'ask-1',
          responder_id: 'user-1',
          responder_role: 'ADMIN',
          responder_name: '测试用户',
          response_text: '客户同意 45 天付款',
          attachments: [],
          created_at: '2026-07-21T15:00:00Z',
        },
        ask_status_after: 'responded',
        report_version: {
          id: 'report-2',
          version: 2,
          is_current: true,
          trigger_event: 'ask_responded',
          created_at: '2026-07-21T15:00:00Z',
        },
      }],
      error: null,
    })

    const response = await submitAskResponse({
      askId: 'ask-1',
      contractId: 'contract-1',
      body: { response_text: '客户同意 45 天付款', attachments: [] },
      user: {
        id: 'user-1',
        email: 'user@example.com',
        display_name: '测试用户',
      } as any,
    })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.data).toMatchObject({
      ask_status_after: 'responded',
      report_version_error: null,
      report_version: {
        id: 'report-2',
        version: 2,
        is_current: true,
      },
    })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'submit_ask_response_report_aggregate',
      {
        p_ask_id: 'ask-1',
        p_contract_id: 'contract-1',
        p_review_id: 'review-1',
        p_contract_version_id: 'version-1',
        p_responder_id: 'user-1',
        p_responder_role: 'ADMIN',
        p_responder_name: '测试用户',
        p_response_text: '客户同意 45 天付款',
        p_attachments: [],
      },
    )
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('does not report success when report publication makes the aggregate roll back', async () => {
    const askLookupQuery = makeAskLookup()
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'ask_items') return askLookupQuery
      throw new Error(`Unexpected table ${table}`)
    })
    ;(supabaseAdmin.rpc as any).mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'forced report publication failure' },
    })

    const response = await submitAskResponse({
      askId: 'ask-1',
      contractId: 'contract-1',
      body: { response_text: '不应部分写入' },
      user: {
        id: 'user-1',
        email: 'user@example.com',
        display_name: '测试用户',
      } as any,
    })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toContain('回应和报告均未写入')
    expect(body.data).toBeUndefined()
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })
})
