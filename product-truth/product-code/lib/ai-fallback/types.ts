// AI 服务降级链 - 类型定义
// 来源：product-truth/02-technical-truth/技术架构.md#4

export type FallbackLevel = 1 | 2 | 3
export type FallbackSource = 'local' | 'cloud' | 'rules'
export type AiTask = 'semantic' | 'extract' | 'classify'

export interface AnalyzeRequest {
  text: string
  pageCount: number
  task: AiTask
  forceCloud?: boolean
}

export interface AnalyzeResult {
  level: FallbackLevel
  source: FallbackSource
  result: unknown
  duration: number // ms
  fallbackReason?: string
}

export interface FallbackAttempt {
  level: FallbackLevel
  source: FallbackSource
  success: boolean
  duration: number
  error?: string
}

// 单级 AI 调用接口
export interface AiClient {
  readonly source: FallbackSource
  readonly timeoutMs: number
  call(req: AnalyzeRequest): Promise<unknown>
  healthCheck(): Promise<boolean>
}
