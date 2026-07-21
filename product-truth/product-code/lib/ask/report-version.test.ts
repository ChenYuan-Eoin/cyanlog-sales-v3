import { describe, expect, it } from 'vitest'
import { buildAskResponseReportData } from './report-version'

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
