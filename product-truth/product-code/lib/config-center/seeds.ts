// REQ: F037-F046
// PURPOSE: 报价域出厂种子数据（配置数据，非需求；业务可改）
// 这些种子会先通过 zod 校验测试，再在 DB 应用阶段随 migration/seed 落库
export const PRODUCT_VERSION_SEEDS = [
  { version_code: 'STD_V6', name: '标准版 V6', deployments: ['PUBLIC_CLOUD'], auth_modes: ['SUB_YEAR'], capabilities: { ha: false, xinchuang: false, onetime: false, migration: false }, mutex: {} },
  { version_code: 'PRO_V6', name: '专业版 V6', deployments: ['PUBLIC_CLOUD', 'PRIVATE'], auth_modes: ['SUB_YEAR', 'SUB_3YEAR'], capabilities: { ha: false, xinchuang: false, onetime: false, migration: false }, mutex: {} },
  { version_code: 'ENT_V6', name: '企业版 V6', deployments: ['PUBLIC_CLOUD', 'PRIVATE', 'HA'], auth_modes: ['SUB_YEAR', 'SUB_3YEAR', 'ONETIME'], capabilities: { ha: true, xinchuang: true, onetime: true, migration: true }, mutex: {} },
  { version_code: 'XINCHUANG_V6', name: '信创版 V6', deployments: ['PRIVATE', 'HA'], auth_modes: ['SUB_YEAR', 'SUB_3YEAR', 'ONETIME'], capabilities: { ha: true, xinchuang: true, onetime: true, migration: false }, mutex: {} },
]

export const BUSINESS_PARAM_SEEDS = [
  { param_key: 'PRIVATE_MIN_SUB', name: '私有部署按年订阅起售', value: 50000, data_type: 'number', unit: '元', category: 'pricing' },
  { param_key: 'PRIVATE_MIN_ONETIME', name: '私有部署一次性授权起售', value: 80000, data_type: 'number', unit: '元', category: 'pricing' },
  { param_key: 'ADDON_MIN_USERS', name: '增售最低账号数', value: 10, data_type: 'number', unit: '账号', category: 'pricing' },
  { param_key: 'MAINT_RATE', name: '维保费率', value: 0.2, data_type: 'number', unit: '/年', category: 'maintenance' },
  { param_key: 'MAINT_MULTI_ENV_INC', name: '多套环境递增', value: 0.02, data_type: 'number', unit: '/套', category: 'maintenance' },
  { param_key: 'HA_NEW_UPLIFT', name: '高可用新购加价', value: 0.2, data_type: 'number', category: 'pricing' },
  { param_key: 'HA_UPGRADE_RATE', name: '老客户升级高可用费率', value: 0.2, data_type: 'number', category: 'pricing' },
  { param_key: 'GIFT_A_DAYS', name: 'A 类赠送人天', value: 5, data_type: 'number', unit: '人天', category: 'gift' },
  { param_key: 'GIFT_B_DAYS', name: 'B 类赠送人天', value: 3, data_type: 'number', unit: '人天', category: 'gift' },
  { param_key: 'GIFT_C_DAYS', name: 'C 类赠送人天', value: 1, data_type: 'number', unit: '人天', category: 'gift' },
  { param_key: 'GIFT_EXTRA_RATE', name: '超出人天单价', value: 5000, data_type: 'number', unit: '元/人天', category: 'gift' },
  { param_key: 'TIER_A_ONETIME', name: 'A 类买断线', value: 600000, data_type: 'number', unit: '元', category: 'customer' },
  { param_key: 'TIER_A_ARR', name: 'A 类 ARR 线', value: 300000, data_type: 'number', unit: '元', category: 'customer' },
  { param_key: 'TIER_B_ARR', name: 'B 类 ARR 线', value: 50000, data_type: 'number', unit: '元', category: 'customer' },
  { param_key: 'PAYMENT_SUGGEST', name: '分期建议', value: [0.3, 0.6, 0.1], data_type: 'json', category: 'payment' },
  { param_key: 'TAX_SOFTWARE', name: '软件税率', value: 0.13, data_type: 'number', category: 'tax' },
  { param_key: 'TAX_SERVICE', name: '服务税率', value: 0.06, data_type: 'number', category: 'tax' },
  { param_key: 'QUOTE_VALID_DAYS', name: '报价有效期', value: 15, data_type: 'number', unit: '天', category: 'quote' },
  { param_key: 'LEGACY_PROTECT_DATE', name: '老客户保护日', value: '2021-02-01', data_type: 'date', category: 'quote' },
  { param_key: 'FX_SOURCE', name: '汇率源', value: 'BOC', data_type: 'string', category: 'quote' },
  { param_key: 'FX_RATE_TYPE', name: '汇率口径', value: 'middle', data_type: 'string', category: 'quote' },
  { param_key: 'DISCOUNT_TIERS', name: '折扣档位(%)', value: [0, 5, 10, 15, 20, 25, 30, 40], data_type: 'json', category: 'pricing' },
  { param_key: 'DISCOUNT_MAX', name: '常规折扣上限(%)', value: 40, data_type: 'number', unit: '%', category: 'pricing' },
]

export const FIELD_DICTIONARY_SEEDS = [
  // 基础识别类
  { field_key: 'quote_id', business_name: '报价单号', source: 'system', transform_rule: 'formula', output_classification: 'header', is_external: true, data_type: 'string' },
  { field_key: 'proj_name', business_name: '项目名称', source: 'input', transform_rule: 'direct', output_classification: 'header', is_external: true, data_type: 'string' },
  { field_key: 'proj_no', business_name: '项目编号', source: 'input', transform_rule: 'direct', output_classification: 'header', is_external: true, data_type: 'string' },
  { field_key: 'quote_date', business_name: '报价日期', source: 'system', transform_rule: 'direct', output_classification: 'header', is_external: true, data_type: 'date' },
  { field_key: 'valid_till', business_name: '有效期至', source: 'computed', transform_rule: 'formula', output_classification: 'header', is_external: true, data_type: 'date' },
  // 商务实体类
  { field_key: 'cust_full_name', business_name: '客户全称', source: 'input', transform_rule: 'direct', output_classification: 'header', is_external: true, data_type: 'string' },
  { field_key: 'supp_full_name', business_name: '我方全称', source: 'config', transform_rule: 'direct', output_classification: 'header', is_external: true, data_type: 'string' },
  { field_key: 'supp_contact', business_name: '我方联系人', source: 'input', transform_rule: 'direct', output_classification: 'header', is_external: true, data_type: 'string' },
  { field_key: 'currency', business_name: '币种', source: 'config', transform_rule: 'direct', output_classification: 'financial', is_external: true, data_type: 'string' },
  { field_key: 'fx_rate', business_name: '汇率', source: 'input', transform_rule: 'formula', output_classification: 'financial', is_external: true, data_type: 'number' },
  // 核心联动类
  { field_key: 'v_type', business_name: '版本类型', source: 'input', transform_rule: 'conditional', output_classification: 'software', is_external: true, data_type: 'string' },
  { field_key: 'v_period', business_name: '服务周期', source: 'input', transform_rule: 'conditional', output_classification: 'software', is_external: true, data_type: 'string' },
  { field_key: 'deploy_mode', business_name: '部署方式', source: 'computed', transform_rule: 'conditional', output_classification: 'software', is_external: true, data_type: 'string' },
  { field_key: 'auth_mode', business_name: '授权方式', source: 'computed', transform_rule: 'conditional', output_classification: 'software', is_external: true, data_type: 'string' },
  { field_key: 'sla_clause', business_name: '关联条款', source: 'computed', transform_rule: 'conditional', output_classification: 'clause', is_external: true, data_type: 'string' },
  // 财务明细类
  { field_key: 'line_items', business_name: '产品/服务行', source: 'computed', transform_rule: 'formula', output_classification: 'software', is_external: true, data_type: 'json' },
  { field_key: 'sub_total', business_name: '分项小计', source: 'computed', transform_rule: 'formula', output_classification: 'financial', is_external: true, data_type: 'number' },
  { field_key: 'discount_rate', business_name: '折扣率', source: 'input', transform_rule: 'formula', output_classification: 'financial', is_external: true, data_type: 'number' },
  { field_key: 'grand_total', business_name: '含税总价', source: 'computed', transform_rule: 'formula', output_classification: 'financial', is_external: true, data_type: 'number' },
  { field_key: 'total_in_words', business_name: '总价大写', source: 'computed', transform_rule: 'formula', output_classification: 'financial', is_external: true, data_type: 'string' },
  { field_key: 'tax_summary', business_name: '税金摘要', source: 'computed', transform_rule: 'formula', output_classification: 'financial', is_external: true, data_type: 'json' },
  // 承诺话术类
  { field_key: 'promo_list', business_name: '优惠承诺', source: 'input', transform_rule: 'semantic', output_classification: 'clause', is_external: true, data_type: 'string' },
  { field_key: 'gift_items', business_name: '赠送行', source: 'input', transform_rule: 'formula', output_classification: 'software', is_external: true, data_type: 'json' },
  { field_key: 'delivery_terms', business_name: '交付说明', source: 'config', transform_rule: 'conditional', output_classification: 'clause', is_external: true, data_type: 'string' },
  { field_key: 'payment_terms', business_name: '付款方式', source: 'config', transform_rule: 'direct', output_classification: 'clause', is_external: true, data_type: 'string' },
  // 隐藏安全类
  { field_key: 'internal_cost', business_name: '内部成本', source: 'config', transform_rule: 'direct', output_classification: 'internal', is_external: false, data_type: 'number' },
  { field_key: 'min_price', business_name: '底价红线', source: 'config', transform_rule: 'direct', output_classification: 'internal', is_external: false, data_type: 'number' },
  { field_key: 'margin_rate', business_name: '毛利率', source: 'computed', transform_rule: 'formula', output_classification: 'internal', is_external: false, data_type: 'number' },
  { field_key: 'approver', business_name: '审批人', source: 'computed', transform_rule: 'direct', output_classification: 'internal', is_external: false, data_type: 'string' },
  { field_key: 'approval_opinion', business_name: '审批意见', source: 'input', transform_rule: 'direct', output_classification: 'internal', is_external: false, data_type: 'string' },
]

export const NUMBERING_RULE_SEEDS = [
  { doc_type: 'quote', prefix: 'QT-', date_format: 'YYYYMMDD', seq_start: 1, padding: 4, separator: '-', sample: 'QT-20260814-0001', enabled: true },
]

export const APPROVAL_CHAIN_SEEDS = [
  { code: 'CHAIN_REGION_LEAD', name: '区域负责人审批', mode: 'serial', quorum: 'all' },
  { code: 'CHAIN_SPECIAL', name: '特批流程', mode: 'serial', quorum: 'all' },
]

export const APPROVAL_RULE_SEEDS = [
  { code: 'R_QUOTE_DISCOUNT_GE50', scene: 'QUOTE_DISCOUNT', condition: { discount: { gte: 50, lt: 100 } }, chain_code: 'CHAIN_REGION_LEAD', priority: 10, enabled: true },
  { code: 'R_QUOTE_DISCOUNT_LT50', scene: 'QUOTE_DISCOUNT', condition: { discount: { lt: 50 } }, chain_code: 'CHAIN_SPECIAL', priority: 20, enabled: true },
]

export const CLAUSE_MAPPING_SEEDS = [
  { code: 'CLAUSE_SUB_SaaS', match: { v_type: 'subscription' }, clause_code: 'SaaS_SERVICE_AGREEMENT', clause_text: 'ONES SaaS 服务协议', required: true },
  { code: 'CLAUSE_ONETIME_PRIVATE', match: { v_type: 'perpetual', deploy: 'private' }, clause_code: 'PRIVATE_LICENSE_MAINT', clause_text: 'ONES 私有化部署授权协议 + 年度维保服务标准', required: true },
]

export const OUTPUT_TEMPLATE_SEEDS = [
  { code: 'TMPL_STD_SUB', name: '标准报价单（订阅）', doc_type: 'standard', scene: 'quote', match_rule: { v_type: 'subscription' }, variables: ['quote_id', 'proj_name', 'cust_full_name', 'supp_full_name', 'line_items', 'grand_total', 'total_in_words', 'tax_summary', 'valid_till', 'sla_clause'] },
  { code: 'TMPL_STD_ONETIME', name: '标准报价单（买断）', doc_type: 'standard', scene: 'quote', match_rule: { v_type: 'perpetual' }, variables: ['quote_id', 'proj_name', 'cust_full_name', 'supp_full_name', 'line_items', 'grand_total', 'total_in_words', 'tax_summary', 'valid_till', 'sla_clause'] },
]

export const ALL_SEEDS = {
  'product-versions': PRODUCT_VERSION_SEEDS,
  'business-params': BUSINESS_PARAM_SEEDS,
  'field-dictionary': FIELD_DICTIONARY_SEEDS,
  'numbering-rules': NUMBERING_RULE_SEEDS,
  'approval-chains': APPROVAL_CHAIN_SEEDS,
  'approval-rules': APPROVAL_RULE_SEEDS,
  'clause-mappings': CLAUSE_MAPPING_SEEDS,
  'output-templates': OUTPUT_TEMPLATE_SEEDS,
} as const
