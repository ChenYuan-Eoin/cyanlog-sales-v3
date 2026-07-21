import { NextResponse } from 'next/server'

export const CANONICAL_RULE_CONTROL_PLANE = '/api/contract-policies/rules'

/**
 * The old `/api/rules` CRUD surface wrote a second, incompatible rule model.
 * Keep the route explicit instead of silently translating Prompt/field/engine
 * payloads into the business rule contract.
 */
export function legacyRuleControlPlaneGone(
  action: string,
  canonicalEndpoint = CANONICAL_RULE_CONTROL_PLANE
) {
  return NextResponse.json({
    error: `旧规则${action}入口已停用。规则必须通过“规则集 → 问题分类 → 具体规则 → 业务属性 → 判定与处理”统一维护。`,
    code: 'RULE_CONTROL_PLANE_MOVED',
    canonicalEndpoint,
  }, { status: 410 })
}
