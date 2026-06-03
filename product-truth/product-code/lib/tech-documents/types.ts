// 技术文档库数据源 - F016
// 复用 F015 (案例库) 的模式

export type DocType = 'PRODUCT_SPEC' | 'TECH_WHITEPAPER' | 'API_DOC' | 'DEPLOY_MANUAL'

export interface TechDocument {
  id: string
  title: string
  doc_type: DocType
  version: string
  content?: string | null
  file_url?: string | null
  tags: string[]
  is_published: boolean
  view_count: number
  created_by?: string | null
  created_at: string
  updated_at: string
}

export interface TechDocumentCreateInput {
  title: string
  doc_type: DocType
  version?: string
  content?: string
  file_url?: string
  tags?: string[]
  is_published?: boolean
}

export const DOC_TYPES: DocType[] = ['PRODUCT_SPEC', 'TECH_WHITEPAPER', 'API_DOC', 'DEPLOY_MANUAL']

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  PRODUCT_SPEC: '产品说明书',
  TECH_WHITEPAPER: '技术白皮书',
  API_DOC: 'API 文档',
  DEPLOY_MANUAL: '部署手册',
}

export const DOC_TYPE_COLOR: Record<DocType, string> = {
  PRODUCT_SPEC: 'bg-blue-100 text-blue-700',
  TECH_WHITEPAPER: 'bg-purple-100 text-purple-700',
  API_DOC: 'bg-emerald-100 text-emerald-700',
  DEPLOY_MANUAL: 'bg-orange-100 text-orange-700',
}
