// lib/profile/types.ts
// 结构化用户画像类型定义
// 备注：用户画像 = 角色 + 行为 + 偏好 + 风险，用于AI个性化和智能路由

/**
 * 用户角色标签
 */
export type RoleTag = 'admin' | 'sales' | 'legal' | 'finance' | 'manager' | 'viewer'

/**
 * 用户行为偏好
 */
export interface UserPreference {
  /** 偏好键 */
  key: string
  /** 偏好值 */
  value: unknown
  /** 设置时间 */
  setAt: string
}

/**
 * 用户行为记录
 */
export interface UserBehavior {
  /** 行为类型 */
  action: string
  /** 发生次数 */
  count: number
  /** 最近发生时间 */
  lastAt: string
  /** 上下文元数据 */
  metadata?: Record<string, unknown>
}

/**
 * 结构化用户画像 — 核心数据结构
 * 说明：画像从短期对话和长期行为中自动构建，用于个性化AI服务
 */
export interface UserProfile {
  /** 用户ID */
  userId: string
  /** 基础信息 */
  basic: {
    displayName: string
    email: string | null
    phone: string | null
    orgId: string | null
    department: string | null
  }
  /** 角色标签（可多选） */
  roleTags: RoleTag[]
  /** 风险敏感度 0-1（越高越谨慎） */
  riskSensitivity: number
  /** 常用操作（按频率排序） */
  frequentActions: UserBehavior[]
  /** 偏好设置 */
  preferences: Record<string, unknown>
  /** 行为摘要（AI提炼） */
  behaviorSummary: string
  /** AI 审核历史统计 */
  aiReviewStats: {
    totalReviews: number
    acceptedRate: number
    avgReviewTime: number
    preferredProvider: string | null
  }
  /** 创建/更新时间 */
  createdAt: string
  updatedAt: string
}

/**
 * 画像构建请求
 */
export interface ProfileBuildRequest {
  userId: string
  /** 时间窗口（天） */
  lookbackDays: number
  /** 是否强制重新构建 */
  force: boolean
}

/**
 * 画像更新事件
 */
export interface ProfileUpdateEvent {
  userId: string
  eventType: 'action' | 'preference_change' | 'ai_review_completed' | 'manual_update'
  payload: Record<string, unknown>
  timestamp: string
}
