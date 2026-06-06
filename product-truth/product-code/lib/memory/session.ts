// lib/memory/session.ts
// SessionMemory — HTTP Session 绑定记忆
// 备注：Session 级上下文，TTL自动过期，持久化到数据库
// 区别于 BufferMemory：Session 绑定 HTTP 请求生命周期，可持久化到 Supabase

import { BaseMemory, MemoryMessage, generateMessageId, estimateTokens } from './base'
import { supabaseAdmin } from '@/lib/supabase'

interface SessionConfig {
  /** Session TTL（毫秒） */
  ttlMs: number
  /** 最大消息数 */
  maxMessages: number
  /** 最大 token 数 */
  maxTokens: number
}

const DEFAULT_SESSION_CONFIG: SessionConfig = {
  ttlMs: 30 * 60 * 1000, // 30分钟
  maxMessages: 50,
  maxTokens: 8000,
}

const TABLE = 'memory_sessions'

/**
 * HTTP Session 绑定记忆 — 支持持久化到数据库
 * 说明：
 * - 为什么持久化？用户刷新页面/重连后，对话上下文不丢失
 * - TTL 机制：过期自动清理，防止数据库膨胀
 * - 与 BufferMemory 的关系：SessionMemory 是 BufferMemory 的持久化层
 *   （Buffer 在内存中快速读写，Session 定期同步到数据库）
 */
export class SessionMemory implements BaseMemory {
  readonly name = 'SessionMemory'

  private config: SessionConfig
  private buffer: MemoryMessage[] = []
  private dirty = false // 标记是否有未同步的变更

  constructor(
    private userId: string,
    private sessionId: string,
    config?: Partial<SessionConfig>
  ) {
    this.config = { ...DEFAULT_SESSION_CONFIG, ...config }
  }

  /**
   * 初始化 — 从数据库加载历史消息
   */
  async init(): Promise<void> {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select('messages')
      .eq('session_id', this.sessionId)
      .eq('user_id', this.userId)
      .single()

    if (error) {
      // Session 不存在，创建新记录
      await this.createSession()
      return
    }

    if (data?.messages) {
      this.buffer = (data.messages as MemoryMessage[]) || []
    }
  }

  async save(message: MemoryMessage): Promise<void> {
    const enriched: MemoryMessage = {
      ...message,
      id: message.id || generateMessageId(),
      timestamp: message.timestamp || Date.now(),
      tokenCount: message.tokenCount || estimateTokens(message.content),
    }

    this.buffer.push(enriched)
    this.dirty = true

    this.enforceConstraints()
    await this.sync()
  }

  async saveMany(messages: MemoryMessage[]): Promise<void> {
    for (const msg of messages) {
      await this.save(msg)
    }
  }

  async load(limit?: number): Promise<MemoryMessage[]> {
    const effectiveLimit = limit ?? this.config.maxMessages
    return this.buffer.slice(-effectiveLimit)
  }

  async loadAll(): Promise<MemoryMessage[]> {
    return [...this.buffer]
  }

  async clear(): Promise<void> {
    this.buffer = []
    this.dirty = true
    await this.sync()
  }

  async getStats() {
    const totalTokens = this.buffer.reduce(
      (sum, m) => sum + (m.tokenCount || estimateTokens(m.content)),
      0
    )
    const timestamps = this.buffer.map((m) => m.timestamp)

    return {
      messageCount: this.buffer.length,
      totalTokens,
      oldestMessage: timestamps.length > 0 ? Math.min(...timestamps) : 0,
      newestMessage: timestamps.length > 0 ? Math.max(...timestamps) : 0,
    }
  }

  /**
   * 强制同步到数据库
   */
  async sync(): Promise<void> {
    if (!this.dirty) return

    await supabaseAdmin
      .from(TABLE)
      .upsert({
        session_id: this.sessionId,
        user_id: this.userId,
        messages: this.buffer,
        updated_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + this.config.ttlMs).toISOString(),
      }, { onConflict: 'session_id' })

    this.dirty = false
  }

  // ─── 私有方法 ──────────────────────────────────────────

  private async createSession(): Promise<void> {
    await supabaseAdmin.from(TABLE).upsert({
      session_id: this.sessionId,
      user_id: this.userId,
      messages: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + this.config.ttlMs).toISOString(),
    }, { onConflict: 'session_id' })
  }

  private enforceConstraints(): void {
    // 按 token 数淘汰
    let totalTokens = this.buffer.reduce(
      (sum, m) => sum + (m.tokenCount || estimateTokens(m.content)),
      0
    )

    while (this.buffer.length > 0 && totalTokens > this.config.maxTokens) {
      const removed = this.buffer.shift()
      if (removed) {
        totalTokens -= removed.tokenCount || estimateTokens(removed.content)
      }
    }

    // 按消息数淘汰
    while (this.buffer.length > this.config.maxMessages) {
      this.buffer.shift()
    }
  }
}

/**
 * SessionMemory 工厂
 */
export function createSessionMemory(
  userId: string,
  sessionId: string,
  config?: Partial<SessionConfig>
): SessionMemory {
  return new SessionMemory(userId, sessionId, config)
}
