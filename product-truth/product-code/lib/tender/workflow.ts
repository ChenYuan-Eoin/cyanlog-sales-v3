// lib/tender/workflow.ts
// 标书中心6步工作流引擎（F013）

export type TenderStep =
  | 'document-import'
  | 'bid-analysis'
  | 'outline'
  | 'global-facts'
  | 'content-edit'
  | 'completed'

export const STEP_ORDER: TenderStep[] = [
  'document-import',
  'bid-analysis',
  'outline',
  'global-facts',
  'content-edit',
  'completed',
]

export interface TenderWorkflow {
  currentStep: TenderStep
  completedSteps: TenderStep[]
  checkpointData: Record<string, unknown>
  canProceed: boolean
  canGoBack: boolean
}

export const STEP_CONFIG: Record<TenderStep, { label: string; description: string }> = {
  'document-import': { label: '导入招标文件', description: '上传并解析招标文件' },
  'bid-analysis': { label: '招标分析', description: '分析招标要求和评分标准' },
  'outline': { label: '生成大纲', description: '基于分析结果生成标书大纲' },
  'global-facts': { label: '全局事实', description: '设置全局变量确保全文一致' },
  'content-edit': { label: '内容编辑', description: '逐章编写和完善标书内容' },
  'completed': { label: '完成', description: '标书生成完成' },
}

export function getNextStep(current: TenderStep): TenderStep | null {
  const idx = STEP_ORDER.indexOf(current)
  if (idx === -1 || idx >= STEP_ORDER.length - 1) return null
  return STEP_ORDER[idx + 1]
}

export function getPrevStep(current: TenderStep): TenderStep | null {
  const idx = STEP_ORDER.indexOf(current)
  if (idx <= 0) return null
  return STEP_ORDER[idx - 1]
}

export function validateStep(step: TenderStep, data: unknown): boolean {
  switch (step) {
    case 'document-import':
      return !!data && typeof (data as { fileUrl?: string }).fileUrl === 'string'
    case 'bid-analysis':
      return !!data && Array.isArray((data as { requirements?: unknown[] }).requirements)
    case 'outline':
      return !!data && Array.isArray((data as { sections?: unknown[] }).sections)
    case 'global-facts':
      return !!data && typeof (data as { variables?: unknown }).variables === 'object'
    case 'content-edit':
      return !!data && typeof (data as { content?: string }).content === 'string'
    case 'completed':
      return true
    default:
      return false
  }
}

export function getStepProgress(current: TenderStep): number {
  const idx = STEP_ORDER.indexOf(current)
  return Math.round(((idx + 1) / STEP_ORDER.length) * 100)
}

export function createInitialWorkflow(): TenderWorkflow {
  return {
    currentStep: 'document-import',
    completedSteps: [],
    checkpointData: {},
    canProceed: false,
    canGoBack: false,
  }
}
