// lib/conversation/manager.ts
// 多轮对话管理器 — 追问/澄清/确认/驳回状态机
// AI审核不是一次性输出，而是可以追问、澄清的交互过程

import { supabaseAdmin } from '@/lib/supabase'
import type { MemoryMessage } from '@/lib/memory/base'
import { generateMessageId } from '@/lib/memory/base'

/**
 * 对话状态
 */
export type ConversationState =
  | 'initial'      // 初始状态，等待用户提问
  | 'thinking'     // AI正在思考
  | 'awaiting_clarification' // 等待用户澄清
  | 'awaiting_confirmation'  // 等待用户确认
  | 'confirmed'    // 用户已确认
  | 'rejected'       // 用户已驳回
  | 'completed'      // 对话完成

/**
 * 对话消息
 */
export interface ConversationMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  metadata?: Record<string, unknown>
}

/**
 * 对话上下文
 */
export interface ConversationContext {
  contractId: string
  userId: string
  state: ConversationState
  messages: ConversationMessage[]
  currentTopic?: string
  pendingQuestion?: string
}

const TABLE = 'contract_conversations'

/**
 * 对话管理器
 * 多轮对话的核心是状态机管理
 * - 用户发起追问 → AI思考 → 等待用户确认 → 确认/驳回 → 完成
 */
export class ConversationManager {
  /**
   * 创建或获取对话上下文
   */
  async getOrCreateContext(contractId: string, userId: string): Promise<ConversationContext> {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select('*')
      .eq('contract_id', contractId)
      .eq('user_id', userId)
      .single()

    if (error || !data) {
      // 创建新对话
      const newContext: ConversationContext = {
        contractId,
        userId,
        state: 'initial',
        messages: [],
      }

      await supabaseAdmin.from(TABLE).insert({
        contract_id: contractId,
        user_id: userId,
        state: 'initial',
        messages: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })

      return newContext
    }

    return {
      contractId: data.contract_id,
      userId: data.user_id,
      state: data.state,
      messages: (data.messages as ConversationMessage[]) || [],
      currentTopic: data.current_topic,
      pendingQuestion: data.pending_question,
    }
  }

  /**
   * 用户发送消息
   * 消息类型决定状态流转
   */
  async sendMessage(
    context: ConversationContext,
    message: string,
    messageType: 'question' | 'clarification' | 'confirmation' | 'rejection'
  ): Promise<ConversationContext> {
    // 保存用户消息
    context.messages.push({
      id: generateMessageId(),
      role: 'user',
      content: message,
      timestamp: Date.now(),
      metadata: { type: messageType },
    })

    // 根据消息类型更新状态
    switch (messageType) {
      case 'question':
        context.state = 'thinking'
        context.pendingQuestion = message
        break
      case 'clarification':
        context.state = 'thinking'
        break
      case 'confirmation':
        context.state = 'confirmed'
        break
      case 'rejection':
        context.state = 'rejected'
        break
    }

    await this.saveContext(context)
    return context
  }

  /**
   * AI回复消息
   */
  async sendAIResponse(
    context: ConversationContext,
    response: string,
    responseType: 'answer' | 'clarification_request' | 'confirmation_request'
  ): Promise<ConversationContext> {
    context.messages.push({
      id: generateMessageId(),
      role: 'assistant',
      content: response,
      timestamp: Date.now(),
      metadata: { type: responseType },
    })

    // 根据回复类型更新状态
    switch (responseType) {
      case 'answer':
        context.state = 'awaiting_confirmation'
        break
      case 'clarification_request':
        context.state = 'awaiting_clarification'
        break
      case 'confirmation_request':
        context.state = 'awaiting_confirmation'
        break
    }

    await this.saveContext(context)
    return context
  }

  /**
   * 完成对话
   */
  async completeConversation(context: ConversationContext): Promise<void> {
    context.state = 'completed'
    await this.saveContext(context)
  }

  /**
   * 获取对话历史（用于AI上下文）
   */
  async getConversationHistory(context: ConversationContext, limit: number = 10): Promise<MemoryMessage[]> {
    return context.messages
      .slice(-limit)
      .map((msg) => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        timestamp: msg.timestamp,
        metadata: msg.metadata,
      }))
  }

  /**
   * 判断对话是否活跃
   */
  isActive(context: ConversationContext): boolean {
    return ['initial', 'thinking', 'awaiting_clarification', 'awaiting_confirmation'].includes(context.state)
  }

  // ─── 私有方法 ──────────────────────────────────────────

  private async saveContext(context: ConversationContext): Promise<void> {
    await supabaseAdmin.from(TABLE).upsert({
      contract_id: context.contractId,
      user_id: context.userId,
      state: context.state,
      messages: context.messages,
      current_topic: context.currentTopic,
      pending_question: context.pendingQuestion,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'contract_id,user_id' })
  }
}

/**
 * 对话管理器工厂
 */
export function createConversationManager(): ConversationManager {
  return new ConversationManager()
}
