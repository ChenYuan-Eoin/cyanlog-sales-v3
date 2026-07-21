import type { AIRuntimeAttempt, AIRuntimeVerificationState } from '../types'

export const MODULE_LABELS: Record<string, string> = {
  quote: '报价',
  quotation: '报价',
  contract_review: '合同',
  contract_drafting: '合同',
  tender_document: '标书',
  shared_ai: '通用能力（待归属）',
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
    description: '存在调用记录，但缺少完整用量、计划身份或必需的审核记录，不能认定模型可用。',
  },
  not_verified: {
    label: '当前计划未验证',
    className: 'border-slate-200 bg-slate-50 text-slate-700',
    description: '当前环境已具备执行路线，但尚未完成一次真实业务任务；单模型测试不能代替产品功能验证。',
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
    label: '当前环境暂不可执行',
    className: 'border-rose-200 bg-rose-50 text-rose-800',
    description: '已发布配置仍有缺失，或所选模型不适合当前环境；系统不会静默改走旧配置。',
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
    if (attempt.outcome === 'passed') return '单模型测试通过'
    if (attempt.outcome === 'failed') return '单模型测试失败'
    return '单模型测试记录不完整'
  }
  if (attempt.outcome === 'passed') return '真实通过'
  if (attempt.outcome === 'fallback_passed') return '降级后通过'
  if (attempt.outcome === 'failed') return '失败'
  return '证据不完整'
}

const FAILURE_REASON_LABELS: Record<string, string> = {
  TIMEOUT: '模型服务响应超时',
  TRANSPORT_FAILED: '无法连接模型服务',
  PROVIDER_UNAVAILABLE: '模型服务暂时不可用',
  PROVIDER_REJECTED: '模型服务拒绝了本次请求',
  TOKEN_USAGE_MISSING: '模型服务未返回完整用量，无法验收',
  OUTPUT_VALIDATION_FAILED: '模型输出未通过业务格式校验',
}

export function attemptFailureSummary(attempt: Pick<AIRuntimeAttempt, 'failure_code' | 'error_message'>) {
  const codes = attempt.failure_code?.split(',').map((code) => code.trim()).filter(Boolean) || []
  if (codes.length > 0) {
    const labels = codes.map((code) => FAILURE_REASON_LABELS[code] || '模型调用未完成')
    return [...new Set(labels)].join('；')
  }
  if (attempt.error_message) {
    return attempt.error_message
      .replaceAll('OpenAI-compatible Provider', '兼容接口的模型服务')
      .replaceAll('Provider', '模型服务')
      .replace(/模型服务\s+/g, '模型服务')
  }
  return null
}
