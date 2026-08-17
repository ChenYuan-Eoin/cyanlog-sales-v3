// REQ: F037-F046
// PURPOSE: 报价域配置对象域注册表（阶段 0 配置地基）
// 原则：机制与数据分离；每个域 = 强类型表 + 校验 + 运行时读取

export type ConfigDomain =
  | 'business-params'
  | 'field-dictionary'
  | 'numbering-rules'
  | 'product-versions'
  | 'price-matrix'
  | 'approval-chains'
  | 'approval-rules'
  | 'clause-mappings'
  | 'output-templates'

export type ConfigStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'

export interface DomainDefinition {
  /** 域 key（URL 段） */
  domain: ConfigDomain
  /** 主表名 */
  table: string
  /** 版本表名（可选） */
  versionTable?: string
  /** 展示名 */
  label: string
  /** 配置中心的 UI 分组 */
  section: '交易配置' | '报价输出' | '组织与权限' | '界面与体验'
}

export const DOMAIN_REGISTRY: Record<ConfigDomain, DomainDefinition> = {
  'business-params': { domain: 'business-params', table: 'business_params', versionTable: 'business_param_versions', label: '业务参数', section: '交易配置' },
  'field-dictionary': { domain: 'field-dictionary', table: 'field_dictionaries', versionTable: 'field_dictionary_versions', label: '字段字典', section: '报价输出' },
  'numbering-rules': { domain: 'numbering-rules', table: 'document_number_rules', label: '单号规则', section: '报价输出' },
  'product-versions': { domain: 'product-versions', table: 'product_versions', label: '版本能力矩阵', section: '交易配置' },
  'price-matrix': { domain: 'price-matrix', table: 'price_matrix', versionTable: 'price_matrix_versions', label: '多维价盘', section: '交易配置' },
  'approval-chains': { domain: 'approval-chains', table: 'approval_chains', label: '审批链', section: '交易配置' },
  'approval-rules': { domain: 'approval-rules', table: 'approval_rules', label: '审批规则', section: '交易配置' },
  'clause-mappings': { domain: 'clause-mappings', table: 'clause_mappings', label: '条款映射', section: '报价输出' },
  'output-templates': { domain: 'output-templates', table: 'output_templates', versionTable: 'output_template_versions', label: '输出模板', section: '报价输出' },
}

export function isConfigDomain(value: string): value is ConfigDomain {
  return value in DOMAIN_REGISTRY
}

/** 报价/合同的隐藏字段（内部）默认 key 集合，用于字段字典种子与白名单测试 */
export const INTERNAL_FIELD_KEYS = [
  'internal_cost',
  'min_price',
  'margin_rate',
  'approver',
  'approval_opinion',
  'rebate_commission',
] as const
