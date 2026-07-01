/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/scoped-access', () => ({
  getAccessibleContract: vi.fn(),
  getOrgRoleCodes: (assignments: Array<{ roleCode?: string }>) => (
    assignments.map((assignment) => assignment.roleCode).filter(Boolean)
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
  },
}))

import { getAccessibleContract } from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { submitAskResponse } from './submit-response'

describe('submitAskResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getAccessibleContract as any).mockResolvedValue({
      contract: { id: 'contract-1' },
      assignments: [{ roleCode: 'ADMIN', permissions: ['contract:review'] }],
    })
  })

  it('creates a report version when a pending ASK is answered', async () => {
    const insertedReportPayloads: any[] = []
    const auditPayloads: any[] = []
    let askItemsCall = 0
    let reportVersionsCall = 0

    const askLookupQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'ask-1',
          contract_id: 'contract-1',
          status: 'pending',
          required_roles: ['sales'],
          response_id: null,
        },
        error: null,
      }),
    }
    const responseInsertQuery = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'response-1',
          ask_id: 'ask-1',
          responder_role: 'ADMIN',
          responder_name: '测试用户',
          response_text: '客户同意 45 天付款',
        },
        error: null,
      }),
    }
    const askUpdateQuery = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { id: 'ask-1' },
        error: null,
      }),
    }
    const askSnapshotQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({
        data: [
          {
            id: 'ask-1',
            ask_code: 'ASK-001',
            clause_ref: null,
            risk_name: '付款周期过长',
            initial_level: 'red',
            question_type: 'financial',
            required_roles: ['finance'],
            question_text: '请确认付款周期',
            qualified_std: '30 天付款',
            status: 'responded',
            response_id: 'response-1',
            closed_reason: null,
            created_at: '2026-07-01T00:00:00.000Z',
            updated_at: '2026-07-01T00:01:00.000Z',
            ask_responses: [
              {
                id: 'response-1',
                responder_id: 'user-1',
                responder_role: 'ADMIN',
                responder_name: '测试用户',
                response_text: '客户同意 45 天付款',
                attachments: [],
                created_at: '2026-07-01T00:01:00.000Z',
              },
            ],
          },
        ],
        error: null,
      }),
    }
    const latestReportQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [{ id: 'report-1', version: 1, is_current: true }],
        error: null,
      }),
    }
    const unsetCurrentQuery = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    const reportInsertQuery = {
      insert: vi.fn((payload) => {
        insertedReportPayloads.push(payload)
        return reportInsertQuery
      }),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'report-2',
          version: 2,
          is_current: true,
          trigger_event: 'ask_responded',
          created_at: '2026-07-01T00:02:00.000Z',
        },
        error: null,
      }),
    }
    const auditQuery = {
      insert: vi.fn((payload) => {
        auditPayloads.push(payload)
        return Promise.resolve({ data: null, error: null })
      }),
    }

    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'ask_items') {
        askItemsCall += 1
        if (askItemsCall === 1) return askLookupQuery
        if (askItemsCall === 2) return askUpdateQuery
        return askSnapshotQuery
      }
      if (table === 'ask_responses') return responseInsertQuery
      if (table === 'ask_audit_logs') return auditQuery
      if (table === 'report_versions') {
        reportVersionsCall += 1
        if (reportVersionsCall === 1) return latestReportQuery
        if (reportVersionsCall === 2) return unsetCurrentQuery
        return reportInsertQuery
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const response = await submitAskResponse({
      askId: 'ask-1',
      contractId: 'contract-1',
      body: { response_text: '客户同意 45 天付款' },
      user: {
        id: 'user-1',
        email: 'user@example.com',
        display_name: '测试用户',
      } as any,
    })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.data.ask_status_after).toBe('responded')
    expect(body.data.report_version).toMatchObject({
      id: 'report-2',
      version: 2,
      is_current: true,
      trigger_event: 'ask_responded',
    })
    expect(insertedReportPayloads[0]).toMatchObject({
      contract_id: 'contract-1',
      version: 2,
      trigger_event: 'ask_responded',
      trigger_ask_id: 'ask-1',
      trigger_user_id: 'user-1',
      is_current: true,
    })
    expect(insertedReportPayloads[0]).not.toHaveProperty('no_ask_explanation')
    expect(insertedReportPayloads[0].report_data.summary).toEqual({
      total: 1,
      pending: 0,
      responded: 1,
      closed: 0,
    })
    expect(unsetCurrentQuery.update).toHaveBeenCalledWith({ is_current: false })
    expect(unsetCurrentQuery.eq).toHaveBeenCalledWith('id', 'report-1')
    expect(auditPayloads.map((payload) => payload.event_type)).toEqual([
      'responded',
      'report_generated',
    ])
  })
})
