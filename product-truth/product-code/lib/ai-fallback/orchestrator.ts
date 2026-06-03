// 降级链主调度器
// 实现 3 级降级：本地 → 云端 → 规则引擎

import type {
  AnalyzeRequest,
  AnalyzeResult,
  FallbackLevel,
  FallbackAttempt,
  AiClient,
} from './types'
import { LocalModelClient } from './local-model'
import { RuleEngineClient } from './rule-engine'

// 路由阈值常量
const LOCAL_MODEL_FULL_PAGES = 15
const LOCAL_MODEL_SEGMENT_PAGES = 40

/**
 * 根据页数和强制标志决定入口级别
 */
export function determineStartLevel(req: AnalyzeRequest): FallbackLevel {
  if (req.forceCloud) return 2
  if (req.pageCount > LOCAL_MODEL_SEGMENT_PAGES) return 2 // 强制云端
  return 1 // 默认本地
}

/**
 * 决策：根据页数选择处理策略
 */
export function determineStrategy(pageCount: number): 'local-full' | 'local-segment' | 'cloud' {
  if (pageCount <= LOCAL_MODEL_FULL_PAGES) return 'local-full'
  if (pageCount <= LOCAL_MODEL_SEGMENT_PAGES) return 'local-segment'
  return 'cloud'
}

/**
 * 降级链执行器
 * 依次尝试各级，失败则降级到下一级
 */
export class FallbackOrchestrator {
  private attempts: FallbackAttempt[] = []

  constructor(
    private local: AiClient = new LocalModelClient(),
    private cloud?: AiClient,
    private rules: AiClient = new RuleEngineClient()
  ) {}

  /**
   * 执行降级链
   */
  async analyze(req: AnalyzeRequest): Promise<AnalyzeResult> {
    this.attempts = []
    const startLevel = determineStartLevel(req)
    const clients: Array<{ level: FallbackLevel; client: AiClient | undefined }> = [
      { level: 1, client: this.local },
      { level: 2, client: this.cloud },
      { level: 3, client: this.rules },
    ]

    // 从 startLevel 开始尝试
    for (const { level, client } of clients) {
      if (level < startLevel) continue
      if (!client) {
        this.recordSkip(level, `Level ${level} 客户端未配置`)
        continue
      }

      const result = await this.tryLevel(level, client, req)
      if (result) {
        return result
      }
    }

    // 永远不会到达这里（rule engine 总是成功）
    throw new Error('降级链全部失败')
  }

  /**
   * 获取本次执行的尝试历史
   */
  getAttempts(): FallbackAttempt[] {
    return [...this.attempts]
  }

  private async tryLevel(
    level: FallbackLevel,
    client: AiClient,
    req: AnalyzeRequest
  ): Promise<AnalyzeResult | null> {
    const start = Date.now()
    try {
      const result = await client.call(req)
      const duration = Date.now() - start
      this.attempts.push({
        level,
        source: client.source,
        success: true,
        duration,
      })
      return {
        level,
        source: client.source,
        result,
        duration,
        fallbackReason:
          level > 1
            ? `Level ${level - 1} failed, fallback to level ${level}`
            : undefined,
      }
    } catch (error) {
      const duration = Date.now() - start
      const errMsg = error instanceof Error ? error.message : String(error)
      this.attempts.push({
        level,
        source: client.source,
        success: false,
        duration,
        error: errMsg,
      })
      return null
    }
  }

  private recordSkip(level: FallbackLevel, reason: string) {
    this.attempts.push({
      level,
      source: 'local',
      success: false,
      duration: 0,
      error: reason,
    })
  }
}
