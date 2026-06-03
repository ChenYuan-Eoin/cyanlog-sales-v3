// 案例库数据源（类型定义 + 枚举）
// F015 案例库管理

export type CaseOutcome = 'SUCCESS' | 'FAILURE'
export type CaseDifficulty = 'EASY' | 'MEDIUM' | 'HARD'

export type CaseIndustry = '金融' | '政府' | '医疗' | '教育' | '企业' | '其他'
export type CaseProduct = '安全' | '云' | '大数据' | 'AI' | '其他'

export interface CaseRecord {
  id: string
  title: string
  customer_name: string
  industry: string
  product: string
  amount: number | null
  duration_months: number | null
  difficulty: CaseDifficulty
  outcome: CaseOutcome
  background?: string | null
  challenge?: string | null
  solution?: string | null
  success_factors?: string | null
  lessons_learned?: string | null
  tags: string[]
  is_published: boolean
  view_count: number
  created_by?: string | null
  created_at: string
  updated_at: string
}

export interface CaseCreateInput {
  title: string
  customer_name: string
  industry: string
  product: string
  amount?: number | null
  duration_months?: number | null
  difficulty?: CaseDifficulty
  outcome: CaseOutcome
  background?: string
  challenge?: string
  solution?: string
  success_factors?: string
  lessons_learned?: string
  tags?: string[]
  is_published?: boolean
}

export const INDUSTRIES: CaseIndustry[] = ['金融', '政府', '医疗', '教育', '企业', '其他']
export const PRODUCTS: CaseProduct[] = ['安全', '云', '大数据', 'AI', '其他']
export const DIFFICULTIES: CaseDifficulty[] = ['EASY', 'MEDIUM', 'HARD']
export const OUTCOMES: CaseOutcome[] = ['SUCCESS', 'FAILURE']

export const DIFFICULTY_LABEL: Record<CaseDifficulty, string> = {
  EASY: '简单',
  MEDIUM: '中等',
  HARD: '复杂',
}

export const OUTCOME_LABEL: Record<CaseOutcome, string> = {
  SUCCESS: '成功',
  FAILURE: '失败',
}

export const OUTCOME_COLOR: Record<CaseOutcome, string> = {
  SUCCESS: 'bg-emerald-100 text-emerald-700',
  FAILURE: 'bg-rose-100 text-rose-700',
}
