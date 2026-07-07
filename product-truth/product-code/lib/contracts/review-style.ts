export type ReviewStyle = 'strict' | 'balanced' | 'business'

export type ReviewStrategyCode = 'AGGRESSIVE' | 'BALANCED' | 'CONSERVATIVE'

export type ReviewStyleOption = {
  value: ReviewStyle
  label: string
  description: string
  strategy: ReviewStrategyCode
}

export const reviewStyleOptions: ReviewStyleOption[] = [
  {
    value: 'strict',
    label: '严审',
    description: '红线、格式和证据定位更敏感，适合用印前审计。',
    strategy: 'AGGRESSIVE',
  },
  {
    value: 'balanced',
    label: '均衡',
    description: '按发布规则默认阈值执行，适合大多数合同审核。',
    strategy: 'BALANCED',
  },
  {
    value: 'business',
    label: '商务',
    description: '优先输出谈判口径和可控风险建议，适合销售现场沟通。',
    strategy: 'CONSERVATIVE',
  },
]

export function reviewStyleStrategy(style: ReviewStyle): ReviewStrategyCode {
  return reviewStyleOptions.find((option) => option.value === style)?.strategy || 'BALANCED'
}

export function reviewStyleLabel(style: ReviewStyle) {
  return reviewStyleOptions.find((option) => option.value === style)?.label || '均衡'
}
