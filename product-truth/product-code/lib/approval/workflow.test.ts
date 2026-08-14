// REQ: F033
// PURPOSE: 审批工作流配置化接线测试（规则命中→级别行；无配置回退原三级）
import { describe, expect, it } from 'vitest'
import { resolveApprovalForQuote, buildApprovalLevels, getApprovalLevel } from './workflow'
import type { ApprovalRuleValue, ApprovalChainValue, ApprovalNodeValue } from '@/lib/config-center/validation'

const RULES: ApprovalRuleValue[] = [
  { code: 'R_GE50', scene: 'QUOTE_DISCOUNT', condition: { discount: { gte: 50, lt: 100 } }, chain_code: 'CHAIN_REGION_LEAD', priority: 10, enabled: true },
  { code: 'R_LT50', scene: 'QUOTE_DISCOUNT', condition: { discount: { lt: 50 } }, chain_code: 'CHAIN_SPECIAL', priority: 20, enabled: true },
]
const CHAINS: ApprovalChainValue[] = [
  { code: 'CHAIN_REGION_LEAD', name: '区域负责人', mode: 'serial', quorum: 'all' },
  { code: 'CHAIN_SPECIAL', name: '特批', mode: 'serial', quorum: 'all' },
]
const NODES: Record<string, ApprovalNodeValue[]> = {
  CHAIN_REGION_LEAD: [{ ord: 1, assignee_type: 'role', assignee_value: 'ROLE_REGION_LEAD', condition: {}, skip_on_unchanged: true, escalation: {} }],
  CHAIN_SPECIAL: [{ ord: 1, assignee_type: 'role', assignee_value: 'ROLE_SPECIAL', condition: {}, skip_on_unchanged: true, escalation: {} }],
}

describe('resolveApprovalForQuote（F033）', () => {
  it('折扣 0.4（40%）→ 特批链 1 级，角色 ROLE_SPECIAL', () => {
    const r = resolveApprovalForQuote(0.4, { rules: RULES, chains: CHAINS, nodesByChain: NODES })
    expect(r.ruleCode).toBe('R_LT50')
    expect(r.levels).toEqual([{ level: 1, approverRole: 'ROLE_SPECIAL', status: 'pending' }])
  })

  it('折扣 0.6（60%）→ 区域负责人链', () => {
    const r = resolveApprovalForQuote(0.6, { rules: RULES, chains: CHAINS, nodesByChain: NODES })
    expect(r.ruleCode).toBe('R_GE50')
    expect(r.levels[0].approverRole).toBe('ROLE_REGION_LEAD')
  })

  it('无配置 → 回退原三级默认（百分数与小数入参等价）', () => {
    expect(getApprovalLevel(4)).toBe(1)
    expect(getApprovalLevel(0.04)).toBe(1)
    expect(getApprovalLevel(9)).toBe(2)
    expect(getApprovalLevel(30)).toBe(3)
  })

  it('节点含中文人名 → 拒绝使用该路径（返回空级别）', () => {
    const badNodes: Record<string, ApprovalNodeValue[]> = {
      CHAIN_SPECIAL: [{ ord: 1, assignee_type: 'role', assignee_value: '王雪婧', condition: {}, skip_on_unchanged: true, escalation: {} }],
    }
    const r = resolveApprovalForQuote(0.4, { rules: RULES, chains: CHAINS, nodesByChain: badNodes })
    expect(r.ruleCode).toBeNull()
    expect(r.levels).toEqual([])
  })
})

describe('buildApprovalLevels', () => {
  it('多节点 → 多级别，首级 pending 其余 waiting', () => {
    const levels = buildApprovalLevels([
      { ord: 1, assignee_type: 'role', assignee_value: 'ROLE_A', condition: {}, skip_on_unchanged: true, escalation: {} },
      { ord: 2, assignee_type: 'role', assignee_value: 'ROLE_B', condition: {}, skip_on_unchanged: true, escalation: {} },
    ])
    expect(levels).toEqual([
      { level: 1, approverRole: 'ROLE_A', status: 'pending' },
      { level: 2, approverRole: 'ROLE_B', status: 'waiting' },
    ])
  })
})
