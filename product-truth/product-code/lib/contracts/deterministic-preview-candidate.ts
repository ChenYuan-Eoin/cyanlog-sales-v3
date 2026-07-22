import type {
  AbsenceDecision,
  DefaultUnknownDecision,
  DeterministicAdjudicationRule,
  DeterministicReviewCriteria,
  FactPredicate,
  FactScalar,
} from './deterministic-adjudicator'

export interface PreviewRuleMessageTemplate {
  levels: {
    level_a: string
    level_b: string
    level_c: string
  }
  risk_title: string
  level_b_description: string
  level_c_description: string
  unknown_description: string
  absence_description: string
  comment_template: string
  negotiation_guidance: string
  bottom_line: string
  evidence_requirement: string
}

export interface DeterministicPreviewRuleDefinition {
  code: string
  name: string
  description: string
  clause_category: string
  level_a_action: 'auto_accept'
  level_b_action: 'negotiate_with_counterparty'
  level_c_action: 'block_or_escalate'
  review_criteria: DeterministicReviewCriteria
  default_unknown: DefaultUnknownDecision
  conflict_group: string | null
  mutually_exclusive_with: string[]
  specificity: number
  message_template: PreviewRuleMessageTemplate
}

const eq = (fact: string, value: FactScalar): FactPredicate => ({ eq: { fact, value } })
const oneOf = (fact: string, values: FactScalar[]): FactPredicate => ({ in: { fact, values } })
const gt = (fact: string, value: number): FactPredicate => ({ gt: { fact, value } })
const gte = (fact: string, value: number): FactPredicate => ({ gte: { fact, value } })
const lt = (fact: string, value: number): FactPredicate => ({ lt: { fact, value } })
const lte = (fact: string, value: number): FactPredicate => ({ lte: { fact, value } })
const present = (fact: string): FactPredicate => ({ present: { fact } })
const not = (predicate: FactPredicate): FactPredicate => ({ not: predicate })
const all = (...predicates: FactPredicate[]): FactPredicate => ({ all: predicates })
const any = (...predicates: FactPredicate[]): FactPredicate => ({ any: predicates })

function messages(input: {
  name: string
  levelA: string
  levelB: string
  levelC: string
  suggestion: string
  evidence: string
  absence: string
}): PreviewRuleMessageTemplate {
  return {
    levels: {
      level_a: input.levelA,
      level_b: input.levelB,
      level_c: input.levelC,
    },
    risk_title: input.name,
    level_b_description: `合同原文与「${input.name}」推荐口径存在可协商偏离：${input.levelB}`,
    level_c_description: `合同原文触及「${input.name}」候选红线：${input.levelC}`,
    unknown_description: `当前证据不足以对「${input.name}」作确定结论，需人工核验。`,
    absence_description: input.absence,
    comment_template: input.suggestion,
    negotiation_guidance: input.suggestion,
    bottom_line: input.levelC,
    evidence_requirement: input.evidence,
  }
}

function rule(input: Omit<DeterministicPreviewRuleDefinition,
  'level_a_action' | 'level_b_action' | 'level_c_action' | 'conflict_group' | 'mutually_exclusive_with'
> & Partial<Pick<DeterministicPreviewRuleDefinition, 'conflict_group' | 'mutually_exclusive_with'>>): DeterministicPreviewRuleDefinition {
  return {
    ...input,
    level_a_action: 'auto_accept',
    level_b_action: 'negotiate_with_counterparty',
    level_c_action: 'block_or_escalate',
    conflict_group: input.conflict_group || null,
    mutually_exclusive_with: input.mutually_exclusive_with || [],
  }
}

/**
 * Conservative, non-current Preview contract for R001-R015.
 *
 * This is intentionally not a Production legal policy. It turns the already
 * approved v22.1 evidence behavior into typed facts and deterministic,
 * auditable predicates. Ambiguous source facts always fall to yellow review;
 * only explicit source facts or a frozen absence decision may create red.
 */
export const DETERMINISTIC_PREVIEW_RULES: DeterministicPreviewRuleDefinition[] = [
  rule({
    code: 'R001',
    name: '付款节奏',
    description: '提取首期比例、尾款账期及是否验收后才支付首款；不得由模型直接判断风险等级。',
    clause_category: 'payment',
    specificity: 101,
    default_unknown: 'yellow_review',
    review_criteria: {
      schema_version: 1,
      absence_decision: 'yellow_review',
      fact_schema: {
        initial_payment_percent: { type: 'number', required: true, nullable: true, min: 0, max: 100 },
        final_payment_days: { type: 'number', required: true, nullable: true, min: 0, max: 3650 },
        first_payment_after_acceptance: { type: 'boolean', required: true, nullable: true },
      },
      level_a: all(
        eq('first_payment_after_acceptance', false),
        gte('initial_payment_percent', 30),
        lte('final_payment_days', 30),
      ),
      level_b: all(
        eq('first_payment_after_acceptance', false),
        gte('initial_payment_percent', 15),
        lt('initial_payment_percent', 30),
        lte('final_payment_days', 30),
      ),
      level_c: any(
        eq('first_payment_after_acceptance', true),
        lt('initial_payment_percent', 15),
        gt('final_payment_days', 30),
      ),
    },
    message_template: messages({
      name: '付款节奏',
      levelA: '首期不低于 30%，尾款账期不超过 30 个工作日，且首款不以验收完成为前提。',
      levelB: '首期为 15%–29%，其余付款条件未触及红线。',
      levelC: '首期低于 15%、首款完全后置到验收后，或尾款账期超过 30 个工作日。',
      suggestion: '请提高首期比例、缩短账期，并避免把全部首款支付后置到验收完成后。',
      evidence: '必须引用同时包含付款比例、付款节点或账期的逐字原文；缺字段时转人工核验。',
      absence: '全文未观察到明确付款安排，请作为文档级黄灯待办补充或人工确认。',
    }),
  }),
  rule({
    code: 'R002',
    name: '终止退款',
    description: '提取终止后的退款范围与是否计息；不从措辞强弱猜测等级。',
    clause_category: 'termination',
    specificity: 102,
    default_unknown: 'yellow_review',
    review_criteria: {
      schema_version: 1,
      absence_decision: 'ignore',
      fact_schema: {
        refund_scope: { type: 'string', required: true, enum: ['none', 'unconsumed', 'full', 'other', 'unknown'] },
        interest_required: { type: 'boolean', required: true, nullable: true },
      },
      level_a: all(eq('refund_scope', 'none'), eq('interest_required', false)),
      level_b: all(eq('refund_scope', 'unconsumed'), eq('interest_required', false)),
      level_c: any(eq('refund_scope', 'full'), eq('interest_required', true)),
    },
    message_template: messages({
      name: '终止退款',
      levelA: '终止后不承担退款或计息义务。',
      levelB: '仅退还未消耗款项且不计息。',
      levelC: '要求全额退款或退款计息。',
      suggestion: '请把退款范围收敛为未消耗部分并明确不计息。',
      evidence: '必须引用同时说明终止、退款范围和计息条件的逐字原文。',
      absence: '全文未观察到终止退款安排，本候选不自动出卡。',
    }),
  }),
  rule({
    code: 'R003',
    name: '税率',
    description: '提取交付形态、税率及混合项目是否分项开票；交付形态不明时不得猜测。',
    clause_category: 'tax',
    specificity: 103,
    default_unknown: 'yellow_review',
    review_criteria: {
      schema_version: 1,
      absence_decision: 'red_risk',
      fact_schema: {
        delivery_type: { type: 'string', required: true, enum: ['software_license', 'private_deployment', 'saas_subscription', 'service_maintenance', 'mixed', 'unknown'] },
        tax_rate_percent: { type: 'number', required: true, nullable: true, min: 0, max: 100 },
        mixed_itemized: { type: 'boolean', required: true, nullable: true },
        mixed_uses_type_specific_rates: { type: 'boolean', required: true, nullable: true },
      },
      level_a: any(
        all(oneOf('delivery_type', ['software_license', 'private_deployment']), eq('tax_rate_percent', 13)),
        all(oneOf('delivery_type', ['saas_subscription', 'service_maintenance']), eq('tax_rate_percent', 6)),
        all(eq('delivery_type', 'mixed'), eq('mixed_itemized', true), eq('mixed_uses_type_specific_rates', true)),
      ),
      level_b: all(eq('delivery_type', 'unknown'), present('tax_rate_percent')),
      level_c: any(
        all(oneOf('delivery_type', ['software_license', 'private_deployment']), present('tax_rate_percent'), not(eq('tax_rate_percent', 13))),
        all(oneOf('delivery_type', ['saas_subscription', 'service_maintenance']), present('tax_rate_percent'), not(eq('tax_rate_percent', 6))),
        all(eq('delivery_type', 'mixed'), any(eq('mixed_itemized', false), eq('mixed_uses_type_specific_rates', false))),
      ),
    },
    message_template: messages({
      name: '税率',
      levelA: '软件授权/私有部署按 13%，SaaS/服务/维保按 6%，混合项目分项开票。',
      levelB: '合同写明税率，但当前证据不足以确定交付形态与税率映射。',
      levelC: '税率与交付形态不匹配，或混合项目未分项使用对应税率。',
      suggestion: '请按实际交付形态明确税率；混合项目应分项列示并分别开票。',
      evidence: '必须引用税率与对应产品/服务形态的逐字原文；交付形态未知时仅黄灯核验。',
      absence: '全文未观察到税率约定，按候选规则形成文档级红灯待办，但不伪造原文锚点。',
    }),
  }),
  rule({
    code: 'R004',
    name: '默示验收期',
    description: '提取是否保留默示验收、期限数值和工作日/自然日单位。',
    clause_category: 'acceptance',
    specificity: 104,
    default_unknown: 'yellow_review',
    review_criteria: {
      schema_version: 1,
      absence_decision: 'yellow_review',
      fact_schema: {
        deemed_acceptance_present: { type: 'boolean', required: true, nullable: true },
        acceptance_days: { type: 'number', required: true, nullable: true, min: 0, max: 3650 },
        day_unit: { type: 'string', required: true, enum: ['working_day', 'calendar_day', 'unknown'] },
      },
      level_a: all(eq('deemed_acceptance_present', true), eq('day_unit', 'working_day'), lte('acceptance_days', 10)),
      level_b: all(eq('deemed_acceptance_present', true), eq('day_unit', 'working_day'), gt('acceptance_days', 10), lte('acceptance_days', 30)),
      level_c: any(eq('deemed_acceptance_present', false), gt('acceptance_days', 30)),
    },
    message_template: messages({
      name: '默示验收期',
      levelA: '保留默示验收且期限不超过 10 个工作日。',
      levelB: '保留默示验收，期限为 11–30 个工作日。',
      levelC: '取消默示验收或期限超过 30 日。',
      suggestion: '请保留默示验收，并将验收反馈期控制在 10 个工作日以内。',
      evidence: '必须引用默示验收机制、期限数值和日期单位；单位不明时只黄灯核验。',
      absence: '全文未观察到默示验收安排，请作为文档级黄灯待办人工确认。',
    }),
  }),
  rule({
    code: 'R005',
    name: '验收不通过',
    description: '提取整改重交、整改次数、解除顺序、全额退款及间接损失责任。',
    clause_category: 'acceptance',
    specificity: 105,
    default_unknown: 'yellow_review',
    review_criteria: {
      schema_version: 1,
      absence_decision: 'yellow_review',
      fact_schema: {
        rectification_before_termination: { type: 'boolean', required: true, nullable: true },
        rectification_attempts: { type: 'number', required: true, nullable: true, min: 0, max: 100 },
        termination_without_rectification: { type: 'boolean', required: true, nullable: true },
        termination_after_rectification: { type: 'boolean', required: true, nullable: true },
        full_refund_required: { type: 'boolean', required: true, nullable: true },
        indirect_loss_liability: { type: 'boolean', required: true, nullable: true },
      },
      level_a: all(
        eq('rectification_before_termination', true),
        eq('termination_without_rectification', false),
        eq('termination_after_rectification', false),
        eq('full_refund_required', false),
        eq('indirect_loss_liability', false),
      ),
      level_b: all(
        eq('rectification_before_termination', true),
        gte('rectification_attempts', 2),
        eq('termination_without_rectification', false),
        eq('termination_after_rectification', true),
        eq('full_refund_required', false),
        eq('indirect_loss_liability', false),
      ),
      level_c: any(
        all(eq('termination_without_rectification', true), eq('full_refund_required', true)),
        eq('indirect_loss_liability', true),
      ),
    },
    message_template: messages({
      name: '验收不通过',
      levelA: '先整改重交，不直接解除、全额退款或承担间接损失。',
      levelB: '至少两次整改后方可解除，且责任限于直接损失。',
      levelC: '可直接解除并要求全额退款，或要求承担一切/间接损失。',
      suggestion: '请增加整改重交和复验步骤，并限制解除、退款和损失范围。',
      evidence: '必须引用整改次数、解除顺序、退款及损失范围的逐字原文。',
      absence: '全文未观察到验收失败处理机制，请作为文档级黄灯待办人工确认。',
    }),
  }),
  rule({
    code: 'R006',
    name: '违约金',
    description: '提取责任方、日违约金比例、总额上限及是否与实际损失累加。',
    clause_category: 'breach',
    specificity: 106,
    default_unknown: 'yellow_review',
    review_criteria: {
      schema_version: 1,
      absence_decision: 'yellow_review',
      fact_schema: {
        liable_party: { type: 'string', required: true, enum: ['supplier', 'customer', 'both', 'unknown'] },
        daily_rate_percent: { type: 'number', required: true, nullable: true, min: 0, max: 100 },
        total_cap_percent: { type: 'number', required: true, nullable: true, min: 0, max: 10000 },
        cumulative_with_actual_loss: { type: 'boolean', required: true, nullable: true },
      },
      level_a: any(
        all(
          eq('liable_party', 'supplier'),
          eq('cumulative_with_actual_loss', false),
          lte('daily_rate_percent', 0.05),
          lte('total_cap_percent', 10),
        ),
        all(
          eq('liable_party', 'customer'),
          eq('cumulative_with_actual_loss', false),
          gte('daily_rate_percent', 0.3),
          lte('total_cap_percent', 100),
        ),
      ),
      level_b: all(
        eq('liable_party', 'supplier'),
        eq('cumulative_with_actual_loss', false),
        lte('daily_rate_percent', 0.3),
        lte('total_cap_percent', 100),
        any(gt('daily_rate_percent', 0.05), gt('total_cap_percent', 10)),
      ),
      level_c: any(
        eq('cumulative_with_actual_loss', true),
        all(eq('liable_party', 'supplier'), gt('daily_rate_percent', 0.3)),
        gt('total_cap_percent', 100),
        all(eq('liable_party', 'customer'), lt('daily_rate_percent', 0.05)),
      ),
    },
    message_template: messages({
      name: '违约金',
      levelA: '乙方日违约金不高于 0.05%，总额上限不高于 10%，且不与实际损失累加。',
      levelB: '乙方日违约金不高于 0.3%、总上限不高于 100%，但高于推荐值。',
      levelC: '日违约金高于 0.3%、总上限高于 100%，或违约金与实际损失累加。',
      suggestion: '请降低日违约金并增加总额上限，删除与全部实际损失累加的约定。',
      evidence: '必须引用责任方、日比例、总上限和累加关系；角色或单位不明时只黄灯核验。',
      absence: '全文未观察到明确违约责任边界，请作为文档级黄灯待办人工确认。',
    }),
  }),
  rule({
    code: 'R007',
    name: '间接损失',
    description: '提取是否排除间接、可得利益、商誉或惩罚性损失，以及是否明确承担。',
    clause_category: 'liability',
    specificity: 107,
    default_unknown: 'yellow_review',
    review_criteria: {
      schema_version: 1,
      absence_decision: 'yellow_review',
      fact_schema: {
        position: { type: 'string', required: true, nullable: true, enum: ['excluded', 'assumed', 'all_losses', 'mixed', 'ambiguous'] },
        loss_types: { type: 'string_array', required: true, nullable: true, unique_items: true, enum: ['indirect', 'lost_profit', 'goodwill', 'punitive'] },
      },
      level_a: eq('position', 'excluded'),
      level_b: eq('position', 'ambiguous'),
      level_c: oneOf('position', ['assumed', 'all_losses', 'mixed']),
    },
    message_template: messages({
      name: '间接损失',
      levelA: '明确排除间接、可得利益、商誉和惩罚性损失。',
      levelB: '责任条款未明确排除间接损失。',
      levelC: '明确承担间接损失或惩罚性赔偿。',
      suggestion: '请明确排除间接损失、可得利益、商誉损失及惩罚性赔偿。',
      evidence: '有原文时引用责任范围；全文未提及只能形成无锚点的文档级待办。',
      absence: '全文未观察到间接损失排除条款，形成文档级黄灯待办；人工定位前不导出批注。',
    }),
  }),
  rule({
    code: 'R008',
    name: '责任总额上限',
    description: '提取责任上限状态、比例与基数；本方保护关系只能由受信角色上下文注入。',
    clause_category: 'liability',
    specificity: 108,
    default_unknown: 'yellow_review',
    review_criteria: {
      schema_version: 1,
      absence_decision: 'red_risk',
      fact_schema: {
        cap_status: { type: 'string', required: true, nullable: true, enum: ['capped', 'uncapped', 'unclear'] },
        cap_percent: { type: 'number', required: true, nullable: true, min: 0, max: 10000 },
        cap_basis: { type: 'string', required: true, nullable: true, enum: ['contract_value', 'fees', 'other', 'unspecified'] },
        our_party_protection: { type: 'string', required: true, nullable: true, source: 'trusted_context', enum: ['mutual', 'our_party_capped', 'our_party_uncapped', 'unclear'] },
      },
      level_a: all(eq('cap_status', 'capped'), oneOf('our_party_protection', ['mutual', 'our_party_capped']), lte('cap_percent', 50)),
      level_b: all(eq('cap_status', 'capped'), oneOf('our_party_protection', ['mutual', 'our_party_capped']), gt('cap_percent', 50), lte('cap_percent', 100)),
      level_c: any(
        eq('cap_status', 'uncapped'),
        gt('cap_percent', 100),
        eq('our_party_protection', 'our_party_uncapped'),
      ),
    },
    message_template: messages({
      name: '责任总额上限',
      levelA: '责任上限双向适用且不超过合同金额的 50%。',
      levelB: '责任上限双向适用，为合同金额的 50%–100%。',
      levelC: '无责任上限、上限超过合同金额 100%，或仅单向限制责任。',
      suggestion: '请增加双向责任总额上限，并将上限控制在合同金额的 50% 以内。',
      evidence: '必须引用上限基数、比例及双向/单向适用范围；缺失时不得伪造原文。',
      absence: '全文未观察到责任总额上限，按候选规则形成文档级红灯待办，但不伪造原文锚点。',
    }),
  }),
  rule({
    code: 'R009',
    name: '保密期',
    description: '提取期限模式、年数和保护范围；义务方向相对本方的映射只能由受信上下文注入。',
    clause_category: 'confidentiality',
    specificity: 109,
    default_unknown: 'yellow_review',
    review_criteria: {
      schema_version: 1,
      absence_decision: 'yellow_review',
      fact_schema: {
        direction: { type: 'string', required: true, nullable: true, source: 'trusted_context', enum: ['mutual', 'one_sided_against_us', 'one_sided_for_us', 'unclear'] },
        duration_mode: { type: 'string', required: true, nullable: true, enum: ['fixed', 'perpetual', 'unspecified'] },
        duration_years: { type: 'number', required: true, nullable: true, min: 0, max: 500 },
        protected_scope: { type: 'string', required: true, nullable: true, enum: ['ordinary', 'trade_secret_only', 'mixed', 'unspecified'] },
      },
      level_a: all(
        eq('direction', 'mutual'),
        any(
          all(eq('duration_mode', 'fixed'), gte('duration_years', 3), lte('duration_years', 7)),
          all(eq('duration_mode', 'perpetual'), eq('protected_scope', 'trade_secret_only')),
        ),
      ),
      level_b: all(eq('direction', 'mutual'), eq('duration_mode', 'fixed'), gt('duration_years', 7), lte('duration_years', 10)),
      level_c: any(
        eq('direction', 'one_sided_against_us'),
        all(eq('duration_mode', 'perpetual'), oneOf('protected_scope', ['ordinary', 'mixed'])),
        all(eq('duration_mode', 'fixed'), gt('duration_years', 10)),
      ),
    },
    message_template: messages({
      name: '保密期',
      levelA: '普通保密义务双向且为 3–7 年；商业秘密可单独永久保护。',
      levelB: '普通保密义务双向且期限超过 7 年、不超过 10 年。',
      levelC: '保密义务单向，或普通保密信息被要求永久/超过 10 年保护。',
      suggestion: '请把普通保密义务改为双向、合理期限，并将永久保护仅限于商业秘密。',
      evidence: '必须区分普通保密信息与商业秘密，并引用期限和双向性原文。',
      absence: '全文未观察到清晰保密期限，请作为文档级黄灯待办人工确认。',
    }),
  }),
  rule({
    code: 'R010',
    name: '主体·收款·金额',
    description: '提取合同主体、收款账户、金额和日期与权威外部来源的对照结果；外部来源缺失时必须 unknown。',
    clause_category: 'business_integrity',
    specificity: 110,
    default_unknown: 'yellow_review',
    review_criteria: {
      schema_version: 1,
      absence_decision: 'yellow_review',
      fact_schema: {
        authoritative_context_available: { type: 'boolean', required: true, nullable: true, source: 'trusted_context' },
        party_match: { type: 'string', required: true, nullable: true, source: 'trusted_context', enum: ['yes', 'no'] },
        bank_account_match: { type: 'string', required: true, nullable: true, source: 'trusted_context', enum: ['yes', 'no'] },
        amounts_consistent: { type: 'boolean', required: true, nullable: true },
        dates_consistent: { type: 'boolean', required: true, nullable: true },
        template_status: { type: 'string', required: true, nullable: true, source: 'trusted_context', enum: ['current', 'old'] },
      },
      level_a: all(
        eq('authoritative_context_available', true),
        eq('party_match', 'yes'),
        eq('bank_account_match', 'yes'),
        eq('amounts_consistent', true),
        eq('dates_consistent', true),
        eq('template_status', 'current'),
      ),
      level_b: any(
        all(
          eq('authoritative_context_available', true),
          eq('party_match', 'yes'),
          eq('bank_account_match', 'yes'),
          eq('amounts_consistent', true),
          eq('dates_consistent', true),
          eq('template_status', 'old'),
        ),
        all(
          eq('authoritative_context_available', null),
          not(eq('amounts_consistent', false)),
          not(eq('dates_consistent', false)),
        ),
      ),
      level_c: any(
        eq('amounts_consistent', false),
        eq('dates_consistent', false),
        all(
          eq('authoritative_context_available', true),
          any(eq('party_match', 'no'), eq('bank_account_match', 'no')),
        ),
      ),
    },
    message_template: messages({
      name: '主体·收款·金额',
      levelA: '主体、账户、金额、签署日期及模板均与权威来源一致。',
      levelB: '核心信息一致，但使用旧版模板。',
      levelC: '主体、收款账户、金额或日期与权威来源不一致。',
      suggestion: '请以工商/财务主数据、正式报价单和当前模板为准逐项核对并更正。',
      evidence: '必须提供独立权威来源；只有合同原文而无对照数据时不得给红线结论。',
      absence: '合同或外部权威数据不足，形成文档级黄灯核验项，不作红线断言。',
    }),
  }),
  rule({
    code: 'R011',
    name: 'IP 归属',
    description: '提取产品 IP、定制开发成果、源代码交付及再销售/转让权。',
    clause_category: 'ip',
    specificity: 111,
    default_unknown: 'yellow_review',
    review_criteria: {
      schema_version: 1,
      absence_decision: 'yellow_review',
      fact_schema: {
        product_ip_owner: { type: 'string', required: true, enum: ['supplier', 'customer', 'shared', 'unclear'] },
        custom_development_owner: { type: 'string', required: true, enum: ['supplier', 'customer', 'shared', 'unclear'] },
        source_code_delivery_required: { type: 'boolean', required: true, nullable: true },
        resale_or_transfer_allowed: { type: 'boolean', required: true, nullable: true },
      },
      level_a: all(
        eq('product_ip_owner', 'supplier'),
        eq('custom_development_owner', 'supplier'),
        eq('source_code_delivery_required', false),
        eq('resale_or_transfer_allowed', false),
      ),
      level_b: all(
        eq('product_ip_owner', 'supplier'),
        oneOf('custom_development_owner', ['customer', 'shared']),
        eq('source_code_delivery_required', false),
        eq('resale_or_transfer_allowed', false),
      ),
      level_c: any(
        oneOf('product_ip_owner', ['customer', 'shared']),
        eq('source_code_delivery_required', true),
        eq('resale_or_transfer_allowed', true),
      ),
    },
    message_template: messages({
      name: 'IP 归属',
      levelA: '供应方保留产品及定制开发 IP，客户取得约定使用许可。',
      levelB: '供应方保留产品 IP，但定制开发成果归属向客户让步。',
      levelC: '客户主张产品 IP、要求交付源代码，或取得再销售/转让权。',
      suggestion: '请保留既有产品 IP，明确客户仅获使用许可；源代码与再销售权需删除或专项审批。',
      evidence: '必须引用产品 IP、定制开发成果、源码和转让权的逐字原文。',
      absence: '全文未观察到清晰 IP 归属，请作为文档级黄灯待办人工确认。',
    }),
  }),
  rule({
    code: 'R012',
    name: '数据安全',
    description: '提取数据归属、处理范围与 AI 训练授权；跨境涉个信适用条件和 DPA 只能由受信上下文注入。',
    clause_category: 'data_security',
    specificity: 112,
    default_unknown: 'yellow_review',
    review_criteria: {
      schema_version: 1,
      absence_decision: 'yellow_review',
      fact_schema: {
        customer_data_owner: { type: 'string', required: true, enum: ['customer', 'supplier', 'shared', 'unclear'] },
        processing_limited_to_service: { type: 'boolean', required: true, nullable: true },
        ai_training_without_authorization: { type: 'boolean', required: true, nullable: true },
        external_context: { type: 'string', required: true, nullable: true, source: 'trusted_context', enum: ['domestic_only', 'cross_border_personal_data', 'not_applicable'] },
        dpa_present: { type: 'boolean', required: true, nullable: true, source: 'trusted_context' },
        additional_security_obligations: { type: 'string', required: true, enum: ['standard', 'negotiable', 'onerous', 'unknown'] },
      },
      level_a: all(
        eq('customer_data_owner', 'customer'),
        eq('processing_limited_to_service', true),
        eq('ai_training_without_authorization', false),
        oneOf('external_context', ['domestic_only', 'not_applicable']),
        eq('additional_security_obligations', 'standard'),
      ),
      level_b: all(
        eq('customer_data_owner', 'customer'),
        eq('processing_limited_to_service', true),
        eq('ai_training_without_authorization', false),
        not(all(eq('external_context', 'cross_border_personal_data'), eq('dpa_present', false))),
        any(
          eq('external_context', null),
          oneOf('additional_security_obligations', ['negotiable', 'onerous']),
          all(eq('external_context', 'cross_border_personal_data'), eq('dpa_present', true)),
        ),
      ),
      level_c: any(
        eq('ai_training_without_authorization', true),
        oneOf('customer_data_owner', ['supplier', 'shared']),
        all(eq('external_context', 'cross_border_personal_data'), eq('dpa_present', false)),
      ),
    },
    message_template: messages({
      name: '数据安全',
      levelA: '客户数据归客户、供应方仅为履约受限处理，且适用条件下具备 DPA。',
      levelB: '核心数据边界可接受，但存在加密、本地化或删除等可谈判附加义务。',
      levelC: '允许未授权 AI 训练，数据归属不当，或跨境涉个信且缺少 DPA。',
      suggestion: '请限制数据仅用于履约，禁止未经授权的 AI 训练，并在跨境涉个信场景补齐 DPA。',
      evidence: '必须先证明客户/主体、跨境和个人信息适用条件；境内场景不得仅因缺 DPA 自动判红。',
      absence: '全文或外部适用条件不足，形成文档级黄灯核验项，不作红线断言。',
    }),
  }),
  rule({
    code: 'R013',
    name: 'SLA',
    description: '提取合同声明的部署形态、可用性、赔偿基数和支持时段；真实部署形态只能由受信产品配置注入。',
    clause_category: 'sla',
    specificity: 113,
    default_unknown: 'yellow_review',
    review_criteria: {
      schema_version: 1,
      absence_decision: 'ignore',
      fact_schema: {
        declared_deployment_mode: { type: 'string', required: true, nullable: true, enum: ['public_cloud', 'private_deployment', 'unclear'] },
        trusted_deployment_mode: { type: 'string', required: true, nullable: true, source: 'trusted_context', enum: ['public_cloud', 'private_deployment'] },
        availability_commitment_present: { type: 'boolean', required: true, nullable: true },
        availability_percent: { type: 'number', required: true, nullable: true, min: 0, max: 100 },
        compensation_basis: { type: 'string', required: true, enum: ['service_fee', 'contract_total', 'business_loss', 'none', 'unknown'] },
        support_24x7_required: { type: 'boolean', required: true, nullable: true },
      },
      level_a: all(
        eq('trusted_deployment_mode', 'public_cloud'),
        eq('availability_commitment_present', true),
        lte('availability_percent', 99.5),
        eq('compensation_basis', 'service_fee'),
        eq('support_24x7_required', false),
      ),
      level_b: all(
        eq('trusted_deployment_mode', 'public_cloud'),
        eq('availability_commitment_present', true),
        gt('availability_percent', 99.5),
        lte('availability_percent', 99.9),
        eq('compensation_basis', 'service_fee'),
        eq('support_24x7_required', false),
      ),
      level_c: any(
        eq('support_24x7_required', true),
        oneOf('compensation_basis', ['contract_total', 'business_loss']),
        all(eq('trusted_deployment_mode', 'private_deployment'), eq('availability_commitment_present', true)),
      ),
    },
    message_template: messages({
      name: 'SLA',
      levelA: '公有云可用性不高于 99.5%，赔偿以服务费为基数且不承诺 7×24。',
      levelB: '公有云可用性高于 99.5%、不超过 99.9%，需评估交付能力。',
      levelC: '按合同总额/营业损失赔偿、私有部署承诺可用性，或要求 7×24。',
      suggestion: '请把赔偿基数限定为服务费，并按实际部署形态和支持能力调整 SLA。',
      evidence: '必须引用部署形态、可用性、赔偿基数和支持时段；产品形态不明时只黄灯核验。',
      absence: '全文未观察到 SLA，本候选不自动出卡。',
    }),
  }),
  rule({
    code: 'R014',
    name: '续约',
    description: '提取续约方式、到期终止、通知期、退出权、涨幅及永久锁价。',
    clause_category: 'renewal',
    specificity: 114,
    default_unknown: 'yellow_review',
    review_criteria: {
      schema_version: 1,
      absence_decision: 'ignore',
      fact_schema: {
        renewal_mode: { type: 'string', required: true, enum: ['written', 'automatic', 'none', 'unknown'] },
        expires_without_written_renewal: { type: 'boolean', required: true, nullable: true },
        notice_days: { type: 'number', required: true, nullable: true, min: 0, max: 3650 },
        exit_right: { type: 'boolean', required: true, nullable: true },
        annual_price_increase_percent: { type: 'number', required: true, nullable: true, min: 0, max: 1000 },
        permanent_price_lock: { type: 'boolean', required: true, nullable: true },
      },
      level_a: all(
        oneOf('renewal_mode', ['written', 'none']),
        eq('expires_without_written_renewal', true),
        eq('permanent_price_lock', false),
      ),
      level_b: all(
        eq('renewal_mode', 'automatic'),
        gte('notice_days', 30),
        eq('exit_right', true),
        lte('annual_price_increase_percent', 5),
        eq('permanent_price_lock', false),
      ),
      level_c: any(
        eq('permanent_price_lock', true),
        all(eq('renewal_mode', 'automatic'), any(eq('exit_right', false), lt('notice_days', 30))),
      ),
    },
    message_template: messages({
      name: '续约',
      levelA: '书面续约或到期自动终止，且无永久锁价。',
      levelB: '自动续期但提前至少 30 日通知、保留退出权且年涨幅不超过 5%。',
      levelC: '永久锁价，或自动续期缺少退出权/合理通知期。',
      suggestion: '请改为书面续约，或为自动续期增加至少 30 日通知、退出权和合理调价机制。',
      evidence: '必须引用续约方式、通知期、退出权和价格机制的逐字原文。',
      absence: '全文未观察到续约安排，本候选不自动出卡。',
    }),
  }),
  rule({
    code: 'R015',
    name: '争议解决',
    description: '分别提取争议机构/法院、城市和适用法律；三轴不完整时不得猜测。',
    clause_category: 'dispute',
    specificity: 115,
    default_unknown: 'yellow_review',
    review_criteria: {
      schema_version: 1,
      absence_decision: 'yellow_review',
      fact_schema: {
        forum_type: { type: 'string', required: true, enum: ['arbitration', 'court', 'unclear'] },
        city: { type: 'string', required: true, enum: ['shenzhen', 'beijing', 'shanghai', 'other_tier1_china', 'other_china', 'overseas', 'unclear'] },
        arbitration_institution: { type: 'string', required: true, enum: ['scia', 'other_china', 'foreign', 'not_applicable', 'unclear'] },
        governing_law: { type: 'string', required: true, enum: ['china', 'foreign', 'unclear'] },
      },
      level_a: all(
        eq('forum_type', 'arbitration'),
        eq('city', 'shenzhen'),
        eq('arbitration_institution', 'scia'),
        eq('governing_law', 'china'),
      ),
      level_b: all(
        eq('governing_law', 'china'),
        any(
          all(eq('forum_type', 'arbitration'), oneOf('city', ['beijing', 'shanghai', 'other_tier1_china']), eq('arbitration_institution', 'other_china')),
          all(eq('forum_type', 'court'), oneOf('city', ['shenzhen', 'beijing', 'shanghai', 'other_tier1_china']), eq('arbitration_institution', 'not_applicable')),
        ),
      ),
      level_c: any(eq('city', 'overseas'), eq('arbitration_institution', 'foreign'), eq('governing_law', 'foreign')),
    },
    message_template: messages({
      name: '争议解决',
      levelA: '中国法律、深圳国际仲裁院（SCIA）仲裁。',
      levelB: '中国法律下的北京/上海等一线城市仲裁或法院管辖。',
      levelC: '境外仲裁、境外法院或外国法律。',
      suggestion: '请优先改为中国法律及深圳 SCIA 仲裁；其他境内一线城市方案需法务确认。',
      evidence: '必须分别引用机构/法院、地点和适用法律；任一轴不明时只黄灯核验。',
      absence: '全文未观察到完整争议解决安排，请作为文档级黄灯待办人工确认。',
    }),
  }),
]

export function buildDeterministicPreviewAdjudicationRule(
  definition: DeterministicPreviewRuleDefinition,
  ruleSnapshotId: string,
): DeterministicAdjudicationRule {
  return {
    rule_code: definition.code,
    rule_snapshot_id: ruleSnapshotId,
    review_criteria: definition.review_criteria,
    default_unknown: definition.default_unknown,
    conflict_group: definition.conflict_group,
    mutually_exclusive_with: definition.mutually_exclusive_with,
    specificity: definition.specificity,
  }
}

export const DETERMINISTIC_PREVIEW_ABSENCE_DECISIONS = Object.fromEntries(
  DETERMINISTIC_PREVIEW_RULES.map((definition) => [
    definition.code,
    definition.review_criteria.absence_decision satisfies AbsenceDecision,
  ]),
) as Record<string, AbsenceDecision>
