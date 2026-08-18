export interface BusinessUsePointDefinition {
  asset_id: string
  module_id: string
  display_name: string
  description: string
  required_capabilities: string[]
}

/**
 * Business use points are code contracts, not free-form administrator data.
 * Adding a new AI-enabled product feature starts by registering its stable use
 * point here; administrators can then bind it without knowing model details.
 */
export const BUSINESS_USE_POINT_REGISTRY: BusinessUsePointDefinition[] = [
  {
    asset_id: 'contract.review.semantic',
    module_id: 'contract_review',
    display_name: '合同语义审核',
    description: '识别合同语义风险并输出结构化风险候选。',
    required_capabilities: ['text_generation', 'structured_output'],
  },
  {
    asset_id: 'contract.review.chat',
    module_id: 'contract_review',
    display_name: '审核辅助对话',
    description: '围绕当前合同和风险点进行辅助问答。',
    required_capabilities: ['text_generation'],
  },
  {
    asset_id: 'contract.draft.generate',
    module_id: 'contract_drafting',
    display_name: '合同起草',
    description: '按业务输入生成合同条款草案。',
    required_capabilities: ['text_generation', 'structured_output'],
  },
  {
    asset_id: 'tender.document.extract',
    module_id: 'tender_document',
    display_name: '标书长文档解析',
    description: '从长文档中提取结构化业务事实。',
    required_capabilities: ['text_generation', 'long_context', 'structured_output'],
  },
  {
    asset_id: 'quote.review.assistant',
    module_id: 'quote',
    display_name: '报价审核助手',
    description: '基于自动审核核验结果生成报价审核意见与修正建议。',
    required_capabilities: ['text_generation', 'structured_output'],
  },
  {
    asset_id: 'generic.ai.analyze',
    module_id: 'shared_ai',
    display_name: '通用 AI 分析（兼容入口）',
    description: '旧通用分析接口的显式兼容用点，后续按业务模块拆分。',
    required_capabilities: ['text_generation'],
  },
]

export function getBusinessUsePointDefinition(assetId: string) {
  return BUSINESS_USE_POINT_REGISTRY.find((definition) => definition.asset_id === assetId) ?? null
}
