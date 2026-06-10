// lib/memory/buffer.test.ts
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { BufferMemory, createBufferMemory } from './buffer'
import type { MemoryMessage } from './base'

describe('BufferMemory', () => {
  let memory: BufferMemory

  beforeEach(() => {
    memory = createBufferMemory('user-1', 'session-1', {
      maxMessages: 5,
      maxTokens: 100,
      cleanupIntervalMs: 100000, // 不触发清理
    })
  })

  afterEach(() => {
    memory.destroy()
  })

  it('should save and load messages', async () => {
    const msg: MemoryMessage = {
      id: 'msg-1',
      role: 'user',
      content: '测试消息',
      timestamp: Date.now(),
    }

    await memory.save(msg)
    const loaded = await memory.load()

    expect(loaded).toHaveLength(1)
    expect(loaded[0].content).toBe('测试消息')
  })

  it('should enforce maxMessages constraint', async () => {
    for (let i = 0; i < 10; i++) {
      await memory.save({
        id: `msg-${i}`,
        role: 'user',
        content: `消息${i}`,
        timestamp: Date.now(),
      })
    }

    const loaded = await memory.load()
    expect(loaded.length).toBeLessThanOrEqual(5)
  })

  it('should enforce maxTokens constraint', async () => {
    // 每条消息约 25 tokens，4条就超过 100 tokens
    for (let i = 0; i < 10; i++) {
      await memory.save({
        id: `msg-${i}`,
        role: 'user',
        content: '这是一条比较长的测试消息，包含足够多的字符来满足token限制',
        timestamp: Date.now(),
      })
    }

    const stats = await memory.getStats()
    expect(stats.totalTokens).toBeLessThanOrEqual(100)
  })

  it('should return most recent messages first', async () => {
    for (let i = 0; i < 3; i++) {
      await memory.save({
        id: `msg-${i}`,
        role: 'user',
        content: `消息${i}`,
        timestamp: Date.now(),
      })
    }

    const loaded = await memory.load(2)
    // 最后两条
    expect(loaded.length).toBe(2)
    expect(loaded[0].content).toBe('消息1') // 倒数第二条
    expect(loaded[1].content).toBe('消息2') // 最后一条
  })

  it('should clear all messages', async () => {
    await memory.save({
      id: 'msg-1',
      role: 'user',
      content: '测试',
      timestamp: Date.now(),
    })

    await memory.clear()
    const loaded = await memory.load()
    expect(loaded).toHaveLength(0)
  })
})
