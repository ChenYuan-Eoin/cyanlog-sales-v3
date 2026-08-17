// REQ: F043
// PURPOSE: 审批规则解析测试（阈值命中/优先级/禁人名）
import { describe, expect, it } from 'vitest'
import {
  resolveApprovalRule,
  resolveApprovalPath,
  assertNoPersonNames,
} from './approval-resolver'
import type { ApprovalRuleValue, ApprovalChainValue, ApprovalNodeValue } from '@/lib/config-center/validation'

const RULES: ApprovalRuleValue[] = [
  { code: 'R_QUOTE_DISCOUNT_GE50', scene: 'QUOTE_DISCOUNT', condition: { discount: { gte: 50, lt: 100 } }, chain_code: 'CHAIN_REGION_LEAD', priority: 10, enabled: true },
  { code: 'R_QUOTE_DISCOUNT_LT50', scene: 'QUOTE_DISCOUNT', condition: { discount: { lt: 50 } }, chain_code: 'CHAIN_SPECIAL', priority: 20, enabled: true },
]

const CHAINS: ApprovalChainValue[] = [
  { code: 'CHAIN_REGION_LEAD', name: '区域负责人审批', mode: 'serial', quorum: 'all' },
  { code: 'CHAIN_SPECIAL', name: '特批流程', mode: 'serial', quorum: 'all' },
]

const NODES: Record<string, ApprovalNodeValue[]> = {
  CHAIN_REGION_LEAD: [{ ord: 1, assignee_type: 'role', assignee_value: 'ROLE_REGION_LEAD', condition: {}, skip_on_unchanged: true, escalation: {} }],
  CHAIN_SPECIAL: [{ ord: 1, assignee_type: 'role', assignee_value: 'ROLE_SPECIAL', condition: {}, skip_on_unchanged: true, escalation: {} }],
}

describe('evaluateCondition', () => {
  it('折扣 40%（4 折）命中 <50 → 特批', () => {
    const rule = resolveApprovalRule(RULES, { scene: 'QUOTE_DISCOUNT', discountPercent: 40 })
    expect(rule?.chain_code).toBe('CHAIN_SPECIAL')
  })
  it('折扣 60%（6 折）命中 ≥50 且 <100 → 区域负责人', () => {
    const rule = resolveApprovalRule(RULES, { scene: 'QUOTE_DISCOUNT', discountPercent: 60 })
    expect(rule?.chain_code).toBe('CHAIN_REGION_LEAD')
  })
  it('折扣 100% 无规则命中 → null', () => {
    const rule = resolveApprovalRule(RULES, { scene: 'QUOTE_DISCOUNT', discountPercent: 100 })
    expect(rule).toBeNull()
  })
  it('多条命中取 priority 最小（最严）', () => {
    const rules = [
      { ...RULES[0] },
      { code: 'R2', scene: 'QUOTE_DISCOUNT' as const, condition: { discount: { gte: 40 } }, chain_code: 'CHAIN_SPECIAL', priority: 5, enabled: true },
    ]
    const rule = resolveApprovalRule(rules, { scene: 'QUOTE_DISCOUNT', discountPercent: 60 })
    expect(rule?.priority).toBe(5)
  })
})

describe('resolveApprovalPath', () => {
  it('规则 → 链 → 有序节点', () => {
    const rule = resolveApprovalRule(RULES, { scene: 'QUOTE_DISCOUNT', discountPercent: 60 })
    const path = resolveApprovalPath(CHAINS, NODES, rule)
    expect(path.chain?.code).toBe('CHAIN_REGION_LEAD')
    expect(path.nodes[0].assignee_value).toBe('ROLE_REGION_LEAD')
    expect(path.matchedBy).toBe('R_QUOTE_DISCOUNT_GE50')
  })
  it('无规则命中 → 空路径（调用方决定兜底）', () => {
    const path = resolveApprovalPath(CHAINS, NODES, null)
    expect(path.nodes).toEqual([])
    expect(path.matchedBy).toBeNull()
  })
})

describe('assertNoPersonNames（审批路由不出现人名硬门）', () => {
  it('角色/关系标识通过', () => {
    const nodes: ApprovalNodeValue[] = [
      { ord: 1, assignee_type: 'role', assignee_value: 'ROLE_REGION_LEAD', condition: {}, skip_on_unchanged: true, escalation: {} },
      { ord: 2, assignee_type: 'relation', assignee_value: 'direct_manager', condition: {}, skip_on_unchanged: true, escalation: {} },
      { ord: 3, assignee_type: 'user', assignee_value: '00000000-0000-4000-8000-000000000001', condition: {}, skip_on_unchanged: true, escalation: {} },
    ]
    expect(assertNoPersonNames(nodes)).toEqual([])
  })
  it('中文人名被拦截', () => {
    const nodes: ApprovalNodeValue[] = [
      { ord: 1, assignee_type: 'role', assignee_value: '王雪婧', condition: {}, skip_on_unchanged: true, escalation: {} },
      { ord: 2, assignee_type: 'user', assignee_value: 'Kid', condition: {}, skip_on_unchanged: true, escalation: {} },
    ]
    expect(assertNoPersonNames(nodes).length).toBe(2)
  })
})
