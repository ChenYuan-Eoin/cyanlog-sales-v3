// lib/memory/buffer.ts
// BufferMemory — 滑动窗口短期记忆
// 备注：滑动窗口策略（maxMessages + maxTokens），FIFO淘汰，内存存储
// 区别于 SessionMemory：Buffer 不绑定 HTTP Session，可以跨请求复用

import { BaseMemory, MemoryMessage, estimateTokens, generateMessageId } from './base'

interface BufferConfig {
  /** 最大消息数 */
  maxMessages: number
  /** 最大 token 数 */
  maxTokens: number
  /** 自动清理间隔（毫秒） */
  cleanupIntervalMs: number
}

const DEFAULT_BUFFER_CONFIG: BufferConfig = {
  maxMessages: 20,
  maxTokens: 4000,
  cleanupIntervalMs: 60000, // 60秒
}

/**
 * 滑动窗口短期记忆 — 内存存储，自动淘汰旧消息
 * 说明：
 * - 为什么用滑动窗口？LLM 上下文长度有限，需要取舍旧消息
 * - 为什么双限制？maxMessages 防消息过多，maxTokens 防 token 超限
 * - 淘汰策略：先按 token 超限淘汰（ oldest first ），再按消息数淘汰
 */
export class BufferMemory implements BaseMemory {
  readonly name = 'BufferMemory'

  private messages: MemoryMessage[] = []
  private config: BufferConfig
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private userId: string,
    private sessionId: string,
    config?: Partial<BufferConfig>
  ) {
    this.config = { ...DEFAULT_BUFFER_CONFIG, ...config }
    this.startCleanupTimer()
  }

  /**
   * 保存单条消息
   */
  async save(message: MemoryMessage): Promise<void> {
    // 自动补全字段
    const enriched: MemoryMessage = {
      ...message,
      id: message.id || generateMessageId(),
      timestamp: message.timestamp || Date.now(),
      tokenCount: message.tokenCount || estimateTokens(message.content),
    }

    this.messages.push(enriched)
    this.enforceConstraints()
  }

  /**
   * 批量保存
   */
  async saveMany(messages: MemoryMessage[]): Promise<void> {
    for (const msg of messages) {
      await this.save(msg)
    }
  }

  /**
   * 加载最近 N 条消息
   * 说明：从后往前取，保证最新上下文
   */
  async load(limit?: number): Promise<MemoryMessage[]> {
    const effectiveLimit = limit ?? this.config.maxMessages
    return this.messages.slice(-effectiveLimit)
  }

  /**
   * 加载所有消息
   */
  async loadAll(): Promise<MemoryMessage[]> {
    return [...this.messages]
  }

  /**
   * 清空
   */
  async clear(): Promise<void> {
    this.messages = []
  }

  /**
   * 获取统计
   */
  async getStats() {
    const totalTokens = this.messages.reduce(
      (sum, m) => sum + (m.tokenCount || estimateTokens(m.content)),
      0
    )
    const timestamps = this.messages.map((m) => m.timestamp)

    return {
      messageCount: this.messages.length,
      totalTokens,
      oldestMessage: timestamps.length > 0 ? Math.min(...timestamps) : 0,
      newestMessage: timestamps.length > 0 ? Math.max(...timestamps) : 0,
    }
  }

  /**
   * 销毁 — 清理定时器
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  // ─── 私有方法 ──────────────────────────────────────────

  /**
   * 强制执行约束条件
   * 策略：
   * 1. 先按 token 数淘汰（从最旧开始）
   * 2. 再按消息数淘汰（从最旧开始）
   */
  private enforceConstraints(): void {
    // 按 token 数淘汰
    let totalTokens = this.messages.reduce(
      (sum, m) => sum + (m.tokenCount || estimateTokens(m.content)),
      0
    )

    while (this.messages.length > 0 && totalTokens > this.config.maxTokens) {
      const removed = this.messages.shift()
      if (removed) {
        totalTokens -= removed.tokenCount || estimateTokens(removed.content)
      }
    }

    // 按消息数淘汰
    while (this.messages.length > this.config.maxMessages) {
      this.messages.shift()
    }
  }

  /**
   * 启动自动清理定时器
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      // 清理超过 TTL 的消息（如果配置了 TTL）
      const now = Date.now()
      this.messages = this.messages.filter((msg) => {
        // 默认 30 分钟 TTL
        return now - msg.timestamp < 30 * 60 * 1000
      })
    }, this.config.cleanupIntervalMs)
  }
}

/**
 * BufferMemory 工厂
 */
export function createBufferMemory(
  userId: string,
  sessionId: string,
  config?: Partial<BufferConfig>
): BufferMemory {
  return new BufferMemory(userId, sessionId, config)
}
