// REQ: F033
// PURPOSE: 审批规则解析（纯函数，替换 lib/approval/workflow.ts 的硬编码 5/10/100）
// 原则：规则/链/节点/角色全配置化；节点只引用角色/组织/关系，禁止人名
import type { ApprovalRuleValue, ApprovalChainValue, ApprovalNodeValue } from '@/lib/config-center/validation'

export interface QuoteApprovalContext {
  scene: 'QUOTE_DISCOUNT' | 'MAINT_DISCOUNT' | 'UPGRADE_DISCOUNT'
  discountPercent: number   // 折扣深度（%），如 40 = 4 折
  amount?: number
  maintenanceRate?: number
  upgradeRate?: number
}

export interface ResolvedApproval {
  rule: ApprovalRuleValue | null
  chain: ApprovalChainValue | null
  nodes: ApprovalNodeValue[]
  matchedBy: string | null
}

/** 条件求值：{discount:{gte,lt}} 等比较器组合；全部满足才命中 */
export function evaluateCondition(condition: Record<string, unknown>, ctx: QuoteApprovalContext): boolean {
  for (const [field, rule] of Object.entries(condition)) {
    if (!rule || typeof rule !== 'object') {
      continue
    }
    const comparators = rule as Record<string, number>
    const actual = field === 'discount' ? ctx.discountPercent
      : field === 'amount' ? ctx.amount
      : field === 'maintenanceRate' ? ctx.maintenanceRate
      : field === 'upgradeRate' ? ctx.upgradeRate
      : undefined
    if (actual === undefined) {
      return false
    }
    for (const [op, value] of Object.entries(comparators)) {
      if (op === 'gte' && !(actual >= value)) return false
      if (op === 'gt' && !(actual > value)) return false
      if (op === 'lte' && !(actual <= value)) return false
      if (op === 'lt' && !(actual < value)) return false
      if (op === 'eq' && !(actual === value)) return false
    }
  }
  return true
}

/**
 * 匹配审批规则：同场景下多条命中取 priority 最小（最严）。
 * 规则未配置时返回 null（由调用方决定默认行为，如直通或按原逻辑兜底）。
 */
export function resolveApprovalRule(
  rules: ApprovalRuleValue[],
  ctx: QuoteApprovalContext
): ApprovalRuleValue | null {
  const enabled = rules.filter((r) => r.enabled !== false && r.scene === ctx.scene)
  const matched = enabled.filter((r) => evaluateCondition(r.condition, ctx))
  if (matched.length === 0) {
    return null
  }
  return matched.sort((a, b) => a.priority - b.priority)[0]
}

/** 解析审批路径：规则 → 链 → 有序节点；节点只暴露指派类型与值，不暴露人名 */
export function resolveApprovalPath(
  chains: ApprovalChainValue[],
  nodesByChain: Record<string, ApprovalNodeValue[]>,
  rule: ApprovalRuleValue | null
): ResolvedApproval {
  if (!rule) {
    return { rule: null, chain: null, nodes: [], matchedBy: null }
  }
  const chain = chains.find((c) => c.code === rule.chain_code) || null
  const nodes = chain ? (nodesByChain[chain.code] || []).sort((a, b) => a.ord - b.ord) : []
  return { rule, chain, nodes, matchedBy: rule.code }
}

/** 不变量校验：审批节点不得引用人名（只允许角色/组织/用户ID/关系标识） */
export function assertNoPersonNames(nodes: ApprovalNodeValue[]): string[] {
  const problems: string[] = []
  const NAME_PATTERN = /[\u4e00-\u9fa5]{2,4}/
  for (const node of nodes) {
    if (node.assignee_type === 'user') {
      // user 类型必须是 UUID（用户ID），不能是姓名
      if (!/^[0-9a-fA-F-]{36}$/.test(node.assignee_value)) {
        problems.push(`节点 ${node.ord} 的 user 指派值不是用户 ID（疑似人名）：${node.assignee_value}`)
      }
    } else if (NAME_PATTERN.test(node.assignee_value)) {
      problems.push(`节点 ${node.ord} 指派值含中文（疑似人名）：${node.assignee_value}`)
    }
  }
  return problems
}
