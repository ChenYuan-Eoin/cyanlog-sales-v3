import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock supabase
const mockChainable = {
  select: vi.fn(() => mockChainable),
  eq: vi.fn(() => mockChainable),
  insert: vi.fn(() => Promise.resolve({ error: null })),
  upsert: vi.fn(() => Promise.resolve({ error: null })),
  single: vi.fn(() => Promise.resolve({ data: null, error: null })),
  maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
}

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(() => mockChainable),
  },
}))

import { ConversationManager, createConversationManager } from './manager'

describe('ConversationManager', () => {
  let manager: ConversationManager

  beforeEach(() => {
    manager = createConversationManager()
  })

  it('should create new context', async () => {
    const context = await manager.getOrCreateContext('contract-1', 'user-1')
    expect(context.contractId).toBe('contract-1')
    expect(context.userId).toBe('user-1')
    expect(context.state).toBe('initial')
    expect(context.messages).toHaveLength(0)
  })

  it('should send message and update state', async () => {
    const context = await manager.getOrCreateContext('contract-1', 'user-1')

    const updated = await manager.sendMessage(context, '这是什么风险？', 'question')
    expect(updated.state).toBe('thinking')
    expect(updated.messages).toHaveLength(1)
    expect(updated.messages[0].content).toBe('这是什么风险？')
  })

  it('should send AI response and update state', async () => {
    const context = await manager.getOrCreateContext('contract-1', 'user-1')

    await manager.sendMessage(context, '这是什么风险？', 'question')
    const updated = await manager.sendAIResponse(context, '这是账期风险', 'answer')
    expect(updated.state).toBe('awaiting_confirmation')
    expect(updated.messages).toHaveLength(2)
  })

  it('should detect active conversation', async () => {
    const context = await manager.getOrCreateContext('contract-1', 'user-1')
    expect(manager.isActive(context)).toBe(true)

    await manager.completeConversation(context)
    expect(manager.isActive(context)).toBe(false)
  })
})
