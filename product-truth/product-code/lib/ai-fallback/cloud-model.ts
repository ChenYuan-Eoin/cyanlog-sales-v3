// 第 2 级降级：云端 AI 模型
// 走中转站或直连 OpenAI 兼容 API

import type { AiClient, AnalyzeRequest } from './types'

export class CloudModelClient implements AiClient {
  readonly source = 'cloud' as const
  readonly timeoutMs = 45_000

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private model: string = 'claude-sonnet-4-6'
  ) {
    if (!baseUrl) throw new Error('CloudModelClient: baseUrl required')
    if (!apiKey) throw new Error('CloudModelClient: apiKey required')
  }

  async call(req: AnalyzeRequest): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: 'system', content: this.getSystemPrompt(req.task) },
            { role: 'user', content: req.text },
          ],
        }),
      })

      if (!response.ok) {
        if (response.status === 429) throw new Error('CLOUD_RATE_LIMITED')
        if (response.status >= 500) throw new Error(`CLOUD_HTTP_${response.status}`)
        throw new Error(`Cloud API HTTP ${response.status}`)
      }

      const data = await response.json()
      return data.choices?.[0]?.message?.content ?? null
    } finally {
      clearTimeout(timeout)
    }
  }

  async healthCheck(): Promise<boolean> {
    return Boolean(this.baseUrl && this.apiKey)
  }

  private getSystemPrompt(task: string): string {
    if (task === 'semantic') return '你是合同审核专家，进行语义分析。'
    if (task === 'extract') return '你是信息抽取专家，从文本中提取结构化数据。'
    return '你是分类专家，对文本进行分类。'
  }
}
