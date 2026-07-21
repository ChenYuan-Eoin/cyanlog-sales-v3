import type { AIRuntimeAttempt, AIRuntimeVerificationState } from '../types'

export const MODULE_LABELS: Record<string, string> = {
  contract_review: '合同审核',
  contract_drafting: '合同起草',
  tender_document: '标书中心',
  shared_ai: '通用 AI 能力',
}

export const VERIFICATION_PRESENTATION: Record<AIRuntimeVerificationState, {
  label: string
  className: string
  description: string
}> = {
  passed: {
    label: '当前计划真实通过',
    className: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    description: '当前发布计划已有真实模型响应和完整 token 证据。',
  },
  fallback_passed: {
    label: '降级后真实通过',
    className: 'border-amber-200 bg-amber-50 text-amber-900',
    description: '前序候选失败后，降级候选完成了真实调用；需要检查首选模型失败原因。',
  },
  failed: {
    label: '最近真实调用失败',
    className: 'border-rose-200 bg-rose-50 text-rose-800',
    description: '当前发布计划已发起真实调用，但最近一次没有得到可验收结果。',
  },
  incomplete_evidence: {
    label: '调用证据不完整',
    className: 'border-amber-200 bg-amber-50 text-amber-900',
    description: '存在调用记录，但缺少完整 token、快照身份或必需的 ReviewRun，不能认定模型可用。',
  },
  not_verified: {
    label: '当前计划未验证',
    className: 'border-slate-200 bg-slate-50 text-slate-700',
    description: '计划可以编译，但当前发布路由还没有完整真实执行；单模型探测不能替代路由验证。',
  },
  stale: {
    label: '当前验证已过期',
    className: 'border-amber-200 bg-amber-50 text-amber-900',
    description: '当前计划只有超过 24 小时的成功或失败记录，不能据此判断模型现在是否可用。',
  },
  evidence_unavailable: {
    label: '真实证据不可读',
    className: 'border-amber-200 bg-amber-50 text-amber-900',
    description: '计划仍可查看，但证据存储当前不可读，不能判断模型是否可用。',
  },
  blocked: {
    label: '运行计划被阻断',
    className: 'border-rose-200 bg-rose-50 text-rose-800',
    description: '六对象依赖不完整或与当前运行环境冲突，系统不会静默改走旧配置。',
  },
}

export function formatRuntimeTime(value: string | null) {
  if (!value) return '时间未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)
}

export function formatRuntimeNumber(value: number) {
  return new Intl.NumberFormat('zh-CN').format(value)
}

export function attemptOutcomeLabel(attempt: AIRuntimeAttempt) {
  if (attempt.snapshot_integrity === 'invalid') return '快照证据无效'
  if (attempt.freshness === 'stale') return '验证已过期'
  if (attempt.execution_mode === 'pinned') {
    if (attempt.outcome === 'passed') return '指定模型探测通过'
    if (attempt.outcome === 'failed') return '指定模型探测失败'
    return '指定模型探测证据不完整'
  }
  if (attempt.outcome === 'passed') return '真实通过'
  if (attempt.outcome === 'fallback_passed') return '降级后通过'
  if (attempt.outcome === 'failed') return '失败'
  return '证据不完整'
}
