/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest'
import {
  buildAskResponseReportData,
  createAskResponseReportVersion,
} from './report-version'

type SupabaseAdmin = typeof import('@/lib/supabase').supabaseAdmin

describe('buildAskResponseReportData', () => {
  it('builds a stable ASK response report snapshot', () => {
    const reportData = buildAskResponseReportData({
      generatedAt: '2026-07-01T00:00:00.000Z',
      triggerAskId: 'ask-1',
      asks: [
        {
          id: 'ask-1',
          ask_code: 'ASK-001',
          clause_ref: '第 3 条',
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
              responder_role: 'FINANCE',
              responder_name: '财务经理',
              response_text: '客户接受 45 天付款',
              attachments: [],
              created_at: '2026-07-01T00:01:00.000Z',
            },
          ],
        },
        {
          id: 'ask-2',
          ask_code: 'ASK-002',
          clause_ref: null,
          risk_name: '验收条款缺失',
          initial_level: 'yellow',
          question_type: 'technical',
          required_roles: ['technical'],
          question_text: '请确认验收依据',
          qualified_std: '补充验收标准',
          status: 'pending',
          response_id: null,
          closed_reason: null,
          created_at: '2026-07-01T00:00:00.000Z',
          updated_at: '2026-07-01T00:00:00.000Z',
          ask_responses: [],
        },
      ],
    })

    expect(reportData.summary).toEqual({
      total: 2,
      pending: 1,
      responded: 1,
      closed: 0,
    })
    expect(reportData.trigger_event).toBe('ask_responded')
    expect(reportData.ask_items[0].response?.response_text).toBe('客户接受 45 天付款')
  })

  it('accepts PostgREST one-to-one response objects as well as arrays', () => {
    const reportData = buildAskResponseReportData({
      generatedAt: '2026-07-01T00:00:00.000Z',
      triggerAskId: 'ask-1',
      asks: [
        {
          id: 'ask-1',
          ask_code: 'ASK-001',
          clause_ref: '第 3 条',
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
          ask_responses: {
            id: 'response-1',
            responder_id: 'user-1',
            responder_role: 'FINANCE',
            responder_name: '财务经理',
            response_text: '客户接受 45 天付款',
            attachments: [],
            created_at: '2026-07-01T00:01:00.000Z',
          },
        },
      ],
    })

    expect(reportData.summary.responded).toBe(1)
    expect(reportData.ask_items[0].response?.response_text).toBe('客户接受 45 天付款')
  })
})

describe('createAskResponseReportVersion', () => {
  it('creates a current report version after ASK response', async () => {
    const insertedPayloads: any[] = []
    let reportVersionsCall = 0

    const latestQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({
        data: [{ id: 'report-2', version: 2, is_current: true }],
        error: null,
      }),
    }
    const unsetCurrentQuery = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
    const asksQuery = {
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
                responder_role: 'FINANCE',
                responder_name: '财务经理',
                response_text: '客户接受 45 天付款',
                attachments: [],
                created_at: '2026-07-01T00:01:00.000Z',
              },
            ],
          },
        ],
        error: null,
      }),
    }
    const insertQuery = {
      insert: vi.fn((payload) => {
        insertedPayloads.push(payload)
        return insertQuery
      }),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: {
          id: 'report-3',
          version: 3,
          is_current: true,
          trigger_event: 'ask_responded',
          created_at: '2026-07-01T00:02:00.000Z',
        },
        error: null,
      }),
    }

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'ask_items') return asksQuery
        if (table === 'report_versions') {
          reportVersionsCall += 1
          if (reportVersionsCall === 1) return latestQuery
          if (reportVersionsCall === 2) return unsetCurrentQuery
          return insertQuery
        }
        throw new Error(`Unexpected table ${table}`)
      }),
    } as unknown as SupabaseAdmin

    const result = await createAskResponseReportVersion({
      contractId: 'contract-1',
      triggerAskId: 'ask-1',
      triggerUserId: 'user-1',
      generatedAt: '2026-07-01T00:02:00.000Z',
      client,
    })

    expect(result.error).toBeNull()
    expect(result.report).toMatchObject({
      id: 'report-3',
      version: 3,
      is_current: true,
      trigger_event: 'ask_responded',
    })
    expect(insertedPayloads[0]).toMatchObject({
      contract_id: 'contract-1',
      version: 3,
      trigger_event: 'ask_responded',
      trigger_ask_id: 'ask-1',
      trigger_user_id: 'user-1',
      is_current: true,
    })
    expect(insertedPayloads[0]).not.toHaveProperty('no_ask_explanation')
    expect(insertedPayloads[0].report_data.summary).toEqual({
      total: 1,
      pending: 0,
      responded: 1,
      closed: 0,
    })
    expect(insertedPayloads[0].report_data.ask_items[0].response.response_text).toBe('客户接受 45 天付款')
    expect(unsetCurrentQuery.update).toHaveBeenCalledWith({ is_current: false })
    expect(unsetCurrentQuery.eq).toHaveBeenCalledWith('id', 'report-2')
  })
})
