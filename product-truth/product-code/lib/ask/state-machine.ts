// lib/ask/state-machine.ts
// REQ: F005 ASK v2 - 状态机（pure function）
// Feature Packet: F005-contract-ASK-upgrade.md v2
//
// 不依赖数据库，可在客户端或服务端使用。
// 约束：
// - pending → responded (录入回应)
// - pending → closed (法务关闭)
// - responded → pending (法务重开)
// - closed → pending (法务重开)
// - 任何状态不能直接 → responded（必须先 pending）

import type { AskStatus } from './types'

export type TransitionAction = 'respond' | 'close' | 'reopen'

export interface TransitionResult {
  allowed: boolean
  fromStatus: AskStatus
  toStatus: AskStatus
  error?: string
}

/**
 * 验证状态流转是否合法
 *
 * @example
 * canTransition('pending', 'respond')   // → responded ✓
 * canTransition('pending', 'close')     // → closed ✓
 * canTransition('responded', 'reopen')  // → pending ✓
 * canTransition('closed', 'reopen')     // → pending ✓
 * canTransition('responded', 'respond') // ❌ 已回应不能再回应
 */
export function canTransition(
  from: AskStatus,
  action: TransitionAction
): TransitionResult {
  const map: Record<AskStatus, Partial<Record<TransitionAction, AskStatus>>> = {
    pending: {
      respond: 'responded',
      close: 'closed',
    },
    responded: {
      reopen: 'pending',
      close: 'closed',
    },
    closed: {
      reopen: 'pending',
    },
  }

  const toStatus = map[from]?.[action]
  if (!toStatus) {
    return {
      allowed: false,
      fromStatus: from,
      toStatus: from,
      error: `Invalid transition: ${from} -[${action}]-> ?`,
    }
  }
  return { allowed: true, fromStatus: from, toStatus }
}

/**
 * 验证报告生成前置条件（硬关单）
 * 报告生成要求所有 ASK 都是 responded 或 closed
 */
export interface ReportGenerationGate {
  canGenerate: boolean
  pendingCount: number
  totalCount: number
}

export function checkReportGate(
  asks: Array<{ status: AskStatus }>
): ReportGenerationGate {
  const total = asks.length
  const pending = asks.filter((a) => a.status === 'pending').length
  return {
    canGenerate: pending === 0,
    pendingCount: pending,
    totalCount: total,
  }
}
