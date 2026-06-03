// 第 1 级降级：本地 LM Studio 模型
// 默认路由，Ollama 兼容 API

import type { AiClient, AnalyzeRequest } from './types'

const DEFAULT_LM_STUDIO_URL = 'http://localhost:1234/v1'

export class LocalModelClient implements AiClient {
  readonly source = 'local' as const
  readonly timeoutMs = 45_000 // 45s 超时

  constructor(private baseUrl: string = DEFAULT_LM_STUDIO_URL) {}

  async call(req: AnalyzeRequest): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'claude-sonnet-4-6', // LM Studio 加载的模型
          messages: [
            { role: 'system', content: this.getSystemPrompt(req.task) },
            { role: 'user', content: req.text },
          ],
        }),
      })

      if (!response.ok) {
        throw new Error(`LM Studio HTTP ${response.status}`)
      }

      const data = await response.json()
      return data.choices?.[0]?.message?.content ?? null
    } finally {
      clearTimeout(timeout)
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      const res = await fetch(`${this.baseUrl}/models`, { signal: controller.signal })
      clearTimeout(timeout)
      return res.ok
    } catch {
      return false
    }
  }

  private getSystemPrompt(task: string): string {
    if (task === 'semantic') return '你是合同审核专家，进行语义分析。'
    if (task === 'extract') return '你是信息抽取专家，从文本中提取结构化数据。'
    return '你是分类专家，对文本进行分类。'
  }
}
