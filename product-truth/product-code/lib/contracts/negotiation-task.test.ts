import { describe, expect, it } from 'vitest'
import { buildNegotiationTasks } from './negotiation-task'

describe('buildNegotiationTasks', () => {
  it('uses persisted ASK items as negotiation tasks and carries customer feedback', () => {
    const tasks = buildNegotiationTasks({
      risks: [
        {
          id: 'risk-1',
          level: 'red',
          title: '付款周期过长',
          suggestion: '改为 30 天付款',
          status: 'open',
        },
      ],
      asks: [
        {
          id: 'ask-1',
          ask_code: 'ASK-001',
          risk_name: '付款周期过长',
          initial_level: 'red',
          required_roles: ['sales', 'finance'],
          question_text: '请确认能否谈判付款周期',
          qualified_std: '客户同意 30 天内付款',
          status: 'responded',
          ask_responses: [
            {
              id: 'response-1',
              responder_name: '王销售',
              responder_role: 'sales',
              response_text: '客户接受 45 天付款',
              created_at: '2026-06-30T00:00:00Z',
            },
          ],
        },
      ],
    })

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      id: 'ask-1',
      source: 'ask',
      ask_code: 'ASK-001',
      risk_id: 'risk-1',
      required: true,
      owner_role: 'sales/finance',
      status: 'responded',
      title: 'ASK-001 付款周期过长',
      objective: '请确认能否谈判付款周期',
      standard: '客户同意 30 天内付款',
      response: {
        response_text: '客户接受 45 天付款',
      },
    })
  })

  it('falls back to open red and yellow risk cards when no ASK exists', () => {
    const tasks = buildNegotiationTasks({
      asks: [],
      risks: [
        { id: 'risk-1', level: 'red', title: '红线风险', status: 'open' },
        { id: 'risk-2', level: 'yellow', title: '黄色风险', description: '需谈判', status: 'open' },
        { id: 'risk-3', level: 'green', title: '绿色事项', status: 'open' },
        { id: 'risk-4', level: 'red', title: '已关闭风险', status: 'accepted' },
      ],
    })

    expect(tasks.map((task) => task.risk_id)).toEqual(['risk-1', 'risk-2'])
    expect(tasks.map((task) => task.source)).toEqual(['risk_card_suggestion', 'risk_card_suggestion'])
  })

  it('adds fallback tasks only for risks not represented by ASK items', () => {
    const tasks = buildNegotiationTasks({
      risks: [
        { id: 'risk-1', level: 'red', title: '已生成 ASK', status: 'open' },
        { id: 'risk-2', level: 'yellow', title: '未生成 ASK', status: 'open' },
      ],
      asks: [
        {
          id: 'ask-1',
          risk_name: '已生成 ASK',
          initial_level: 'red',
          required_roles: ['sales'],
          question_text: '请谈判',
          status: 'pending',
        },
      ],
    })

    expect(tasks).toHaveLength(2)
    expect(tasks[0].source).toBe('ask')
    expect(tasks[1]).toMatchObject({
      source: 'risk_card_suggestion',
      risk_id: 'risk-2',
    })
  })

  it('reads one-to-one ASK responses returned as objects', () => {
    const tasks = buildNegotiationTasks({
      risks: [
        { id: 'risk-1', level: 'red', title: '付款周期过长', status: 'open' },
      ],
      asks: [
        {
          id: 'ask-1',
          ask_code: 'ASK-001',
          risk_name: '付款周期过长',
          initial_level: 'red',
          required_roles: ['finance'],
          question_text: '请确认付款周期',
          qualified_std: '30 天付款',
          status: 'responded',
          ask_responses: {
            id: 'response-1',
            responder_name: '财务经理',
            responder_role: 'FINANCE',
            response_text: '客户接受 45 天付款',
            created_at: '2026-07-01T00:00:00Z',
          },
        },
      ],
    })

    expect(tasks[0]).toMatchObject({
      source: 'ask',
      status: 'responded',
      response: {
        response_text: '客户接受 45 天付款',
      },
    })
  })
})
