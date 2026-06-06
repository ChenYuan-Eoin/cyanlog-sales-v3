// lib/memory/base.ts
// 记忆系统基类 — 支持短期/长期/用户画像多种记忆类型
// 记忆分层：短期→长期→持久化，滑动窗口策略，TTL过期

/**
 * 消息角色
 */
export type MessageRole = 'system' | 'user' | 'assistant' | 'tool'

/**
 * 记忆消息 — Agent/LLM 对话中的基本单元
 */
export interface MemoryMessage {
  id: string
  role: MessageRole
  content: string
  /** 消息时间戳 */
  timestamp: number
  /** 元数据（如工具调用结果、引用来源） */
  metadata?: Record<string, unknown>
  /** 关联的 Agent/Tool ID */
  agentId?: string
  /** 使用的 token 数（估算） */
  tokenCount?: number
}

/**
 * 记忆上下文 — Agent 执行时的完整上下文
 */
export interface MemoryContext {
  /** 用户ID */
  userId: string
  /** 会话/会话ID（可选，长期记忆时为空） */
  sessionId?: string
  /** 当前消息 */
  messages: MemoryMessage[]
  /** 用户画像快照 */
  userProfile?: Record<string, unknown>
  /** 环境变量 */
  env: Record<string, unknown>
}

/**
 * 记忆配置
 */
export interface MemoryConfig {
  /** 最大消息数（滑动窗口） */
  maxMessages: number
  /** 最大 token 数（估算） */
  maxTokens: number
  /** TTL 过期时间（毫秒） */
  ttlMs: number
  /** 是否持久化到数据库 */
  persistent: boolean
}

/**
 * 基础记忆接口 — 所有记忆类型的抽象
 * 说明：分层设计，统一接口，不同实现策略
 */
export interface BaseMemory {
  /** 记忆名称 */
  readonly name: string

  /**
   * 保存消息到记忆
   */
  save(message: MemoryMessage): Promise<void>

  /**
   * 批量保存消息
   */
  saveMany(messages: MemoryMessage[]): Promise<void>

  /**
   * 获取当前上下文中的消息
   * @param limit 返回消息数量限制
   */
  load(limit?: number): Promise<MemoryMessage[]>

  /**
   * 获取所有记忆消息（不限制数量）
   */
  loadAll(): Promise<MemoryMessage[]>

  /**
   * 清空记忆
   */
  clear(): Promise<void>

  /**
   * 获取记忆状态摘要
   */
  getStats(): Promise<{
    messageCount: number
    totalTokens: number
    oldestMessage: number
    newestMessage: number
  }>
}

/**
 * 记忆工厂 — 根据配置创建不同类型的记忆
 */
export interface MemoryFactory {
  createSessionMemory(userId: string, sessionId: string): BaseMemory
  createBufferMemory(userId: string, maxTokens?: number): BaseMemory
  createUserProfileMemory(userId: string): BaseMemory
}

/**
 * 估算文本 token 数（简化版，按字符/4 估算）
 * 说明：实际应用应使用 tiktoken 等精确计算
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * 生成消息 ID
 */
export function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}
