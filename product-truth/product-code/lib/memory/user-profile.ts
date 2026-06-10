// lib/memory/user-profile.ts
// UserProfileMemory — 长期用户画像记忆
// 备注：用户行为持久化，画像自动更新，跨会话长期记忆

import { BaseMemory, MemoryMessage, generateMessageId } from './base'
import { supabaseAdmin } from '@/lib/supabase'

/**
 * 用户画像 — 结构化长期记忆
 * 说明：从短期对话中提取结构化信息，构建用户画像，用于个性化服务
 */
export interface UserProfileData {
  /** 用户ID */
  userId: string
  /** 角色标签 */
  roleTags: string[]
  /** 常用操作统计 */
  frequentActions: Array<{ action: string; count: number; lastAt: string }>
  /** 风险敏感度（0-1，越高越谨慎） */
  riskSensitivity: number
  /** 偏好设置 */
  preferences: Record<string, unknown>
  /** 行为摘要（自动提炼） */
  behaviorSummary: string
  /** 创建时间 */
  createdAt: string
  /** 更新时间 */
  updatedAt: string
}

const TABLE = 'user_profiles'

/**
 * 用户画像记忆 — 持久化到数据库，跨会话长期保留
 * 说明：
 * - 与 SessionMemory 的区别：Session 是会话级（30分钟），Profile 是用户级（永久）
 * - 数据来源：埋点、对话分析、手动设置
 * - 应用场景：AI审核时根据用户画像调整策略（如高敏感度用户更严格审核）
 */
export class UserProfileMemory implements BaseMemory {
  readonly name = 'UserProfileMemory'

  private profile: UserProfileData | null = null
  private userId: string

  constructor(userId: string) {
    this.userId = userId
  }

  /**
   * 加载用户画像
   */
  async loadProfile(): Promise<UserProfileData | null> {
    if (this.profile) return this.profile

    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select('*')
      .eq('user_id', this.userId)
      .single()

    if (error || !data) {
      // 不存在则创建默认画像
      this.profile = this.createDefaultProfile()
      await this.saveProfile()
      return this.profile
    }

    this.profile = {
      userId: data.user_id,
      roleTags: data.role_tags || [],
      frequentActions: data.frequent_actions || [],
      riskSensitivity: data.risk_sensitivity || 0.5,
      preferences: data.preferences || {},
      behaviorSummary: data.behavior_summary || '',
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    }

    return this.profile
  }

  /**
   * 更新用户画像
   */
  async updateProfile(updates: Partial<Omit<UserProfileData, 'userId' | 'createdAt'>>): Promise<void> {
    if (!this.profile) {
      await this.loadProfile()
    }

    this.profile = {
      ...this.profile!,
      ...updates,
      updatedAt: new Date().toISOString(),
    }

    await this.saveProfile()
  }

  /**
   * 记录用户行为（自动更新画像）
   * 说明：埋点数据自动聚合到画像，如"用户经常审核高金额合同"→ 自动标记高敏感度
   */
  async recordAction(action: string, metadata?: Record<string, unknown>): Promise<void> {
    if (!this.profile) {
      await this.loadProfile()
    }

    const actions = this.profile!.frequentActions
    const existing = actions.find((a) => a.action === action)

    if (existing) {
      existing.count += 1
      existing.lastAt = new Date().toISOString()
    } else {
      actions.push({
        action,
        count: 1,
        lastAt: new Date().toISOString(),
      })
    }

    // 根据行为更新风险敏感度
    this.updateRiskSensitivity(action, metadata)

    this.profile!.updatedAt = new Date().toISOString()
    await this.saveProfile()
  }

  // ─── BaseMemory 接口实现 ───────────────────────────────

  /** 保存消息到画像（提取关键信息） */
  async save(message: MemoryMessage): Promise<void> {
    // 从对话中提取结构化信息（简化版）
    // 说明：实际应用应使用 LLM 提取，这里用关键词匹配演示
    const content = message.content.toLowerCase()

    if (content.includes('风险') || content.includes('问题')) {
      await this.recordAction('关注风险', { context: message.metadata })
    }

    if (content.includes('同意') || content.includes('通过')) {
      await this.recordAction('批准操作', { context: message.metadata })
    }
  }

  async saveMany(messages: MemoryMessage[]): Promise<void> {
    for (const msg of messages) {
      await this.save(msg)
    }
  }

  async load(): Promise<MemoryMessage[]> {
    // ProfileMemory 不直接返回消息，返回画像摘要作为 system 消息
    const profile = await this.loadProfile()
    if (!profile) return []

    return [{
      id: generateMessageId(),
      role: 'system',
      content: `用户画像: ${profile.behaviorSummary}。风险敏感度: ${profile.riskSensitivity}。`,
      timestamp: Date.now(),
    }]
  }

  async loadAll(): Promise<MemoryMessage[]> {
    return this.load()
  }

  async clear(): Promise<void> {
    this.profile = this.createDefaultProfile()
    await this.saveProfile()
  }

  async getStats() {
    await this.loadProfile()
    return {
      messageCount: 0, // Profile 不存储消息
      totalTokens: 0,
      oldestMessage: 0,
      newestMessage: Date.now(),
    }
  }

  // ─── 私有方法 ──────────────────────────────────────────

  private createDefaultProfile(): UserProfileData {
    return {
      userId: this.userId,
      roleTags: [],
      frequentActions: [],
      riskSensitivity: 0.5,
      preferences: {},
      behaviorSummary: '新用户，暂无行为数据',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  private async saveProfile(): Promise<void> {
    if (!this.profile) return

    await supabaseAdmin.from(TABLE).upsert({
      user_id: this.profile.userId,
      role_tags: this.profile.roleTags,
      frequent_actions: this.profile.frequentActions,
      risk_sensitivity: this.profile.riskSensitivity,
      preferences: this.profile.preferences,
      behavior_summary: this.profile.behaviorSummary,
      updated_at: this.profile.updatedAt,
    }, { onConflict: 'user_id' })
  }

  private updateRiskSensitivity(action: string, _metadata?: Record<string, unknown>): void {
    if (!this.profile) return

    // 简化版：根据行为调整风险敏感度
    const riskActions = ['关注风险', '拒绝', '驳回']
    const safeActions = ['批准', '通过', '同意']

    if (riskActions.some((a) => action.includes(a))) {
      this.profile.riskSensitivity = Math.min(1, this.profile.riskSensitivity + 0.05)
    } else if (safeActions.some((a) => action.includes(a))) {
      this.profile.riskSensitivity = Math.max(0, this.profile.riskSensitivity - 0.02)
    }
  }
}

/**
 * UserProfileMemory 工厂
 */
export function createUserProfileMemory(userId: string): UserProfileMemory {
  return new UserProfileMemory(userId)
}
