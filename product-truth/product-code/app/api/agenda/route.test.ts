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

import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { POST } from './route'

function makeMalformedRequest(): any {
  return {
    json: async () => {
      throw new SyntaxError('Unexpected token')
    },
    method: 'POST',
    url: 'https://example.test/api/agenda',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeJsonRequest(body: unknown): any {
  return {
    json: async () => body,
    method: 'POST',
    url: 'https://example.test/api/agenda',
    headers: new Headers({ 'content-type': 'application/json' }),
  }
}

function makeAgendaInsertChain(result: any) {
  const chain: any = {}
  chain.insert = vi.fn().mockReturnValue(chain)
  chain.select = vi.fn().mockReturnValue(chain)
  chain.single = vi.fn().mockResolvedValue(result)
  return chain
}

function makeReminderRuleChain(result: any) {
  const chain: any = {}
  ;['select', 'eq', 'order', 'limit'].forEach((method) => {
    chain[method] = vi.fn().mockReturnValue(chain)
  })
  chain.single = vi.fn().mockResolvedValue(result)
  return chain
}

function makeReminderInsertChain() {
  return {
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  }
}

describe('POST /api/agenda validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(requireAuth as any).mockResolvedValue({ id: 'user-1' })
  })

  it('无效 JSON 返回参数错误且不访问数据库', async () => {
    const res = await POST(makeMalformedRequest())
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error.code).toBe('V001')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('创建成功返回 common envelope', async () => {
    const agenda = {
      id: 'agenda-1',
      title: '客户会议',
      start_at: '2026-06-27T02:00:00.000Z',
    }
    const agendaChain = makeAgendaInsertChain({ data: agenda, error: null })
    const ruleChain = makeReminderRuleChain({ data: { id: 'rule-1', trigger_offset_minutes: 30 }, error: null })
    const reminderChain = makeReminderInsertChain()
    ;(supabaseAdmin.from as any).mockImplementation((table: string) => {
      if (table === 'agenda_items') return agendaChain
      if (table === 'reminder_rules') return ruleChain
      if (table === 'reminders') return reminderChain
      throw new Error(`unexpected table ${table}`)
    })

    const res = await POST(makeJsonRequest({
      title: '客户会议',
      start_at: '2026-06-27T02:00:00.000Z',
      agenda_type: 'MEETING',
      priority: 'NORMAL',
      all_day: false,
    }))
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body).toMatchObject({
      success: true,
      data: agenda,
    })
    expect(supabaseAdmin.from).toHaveBeenCalledWith('agenda_items')
    expect(supabaseAdmin.from).toHaveBeenCalledWith('reminder_rules')
    expect(supabaseAdmin.from).toHaveBeenCalledWith('reminders')
  })
})
