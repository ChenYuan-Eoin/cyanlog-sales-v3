export interface ContractTemplateCatalogItem {
  id: string
  name: string
  description: string
  category: string
  contractType: string
}

export const CONTRACT_TEMPLATES: ContractTemplateCatalogItem[] = [
  {
    id: 'standard-service-agreement',
    name: '标准服务协议',
    description: '适用于通用 SaaS 服务、实施与运维交付。',
    category: '服务协议',
    contractType: '服务合同',
  },
  {
    id: 'private-deployment-agreement',
    name: '私有部署协议',
    description: '适用于私有化部署、验收和维保场景。',
    category: '部署协议',
    contractType: '技术开发合同',
  },
  {
    id: 'subscription-renewal-agreement',
    name: '订阅续约协议',
    description: '适用于续费、扩容和订阅期限变更。',
    category: '订阅协议',
    contractType: '销售合同',
  },
]

export function getContractTemplateById(id: string): ContractTemplateCatalogItem | null {
  return CONTRACT_TEMPLATES.find((template) => template.id === id) ?? null
}
