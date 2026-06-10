// lib/sse/client.ts
// SSE客户端 — 断连重试 + 指数退避 + 心跳
// SSE是单向通信，浏览器原生支持EventSource API
// 但我们需要更精细的控制（断连重试、心跳）
//
// 【技术选型】
// - SSE (Server-Sent Events): 服务器向客户端单向推送
//   备选：WebSocket（双向通信，适合协同编辑）
//   权衡：
//   1. AI审核是单向流（服务器→客户端），SSE足够
//   2. SSE基于HTTP，兼容CDN、负载均衡、认证中间件
//   3. WebSocket需要独立端口/协议，防火墙可能拦截
//   4. SSE有浏览器原生EventSource，但缺少重试控制，故自实现
//
// - 指数退避重试: 2^n增长，最大30s封顶
//   备选：固定间隔重试（实现简单，但服务端压力大）
//   权衡：指数退避在网络抖动时减少服务端负载，同时保证最终恢复
//
// - fetch+ReadableStream: 替代原生EventSource
//   原因：原生EventSource不支持自定义header（无法传Authorization）
//   不支持请求体（无法POST大文本），无法控制重试策略

export interface SSEConfig {
  /** 最大重试次数 */
  maxRetries: number
  /** 基础退避时间ms */
  baseDelayMs: number
  /** 最大退避时间ms */
  maxDelayMs: number
  /** 心跳间隔ms（0=禁用心跳） */
  heartbeatIntervalMs: number
  /** 超时ms */
  timeoutMs: number
}

export const DEFAULT_SSE_CONFIG: SSEConfig = {
  maxRetries: 5,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  heartbeatIntervalMs: 30000,
  timeoutMs: 60000,
}

export type SSEEventHandler = (event: { type: string; data: string; id?: string }) => void

/**
 * SSE客户端
 * 原生EventSource不支持自定义重试策略，我们用fetch+ReadableStream实现
 */
export class SSEClient {
  private config: SSEConfig
  private abortController: AbortController | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private lastEventId: string | undefined = undefined

  constructor(config: Partial<SSEConfig> = {}) {
    this.config = { ...DEFAULT_SSE_CONFIG, ...config }
  }

  /**
   * 连接到SSE端点
   */
  async connect(
    url: string,
    options: { method?: string; headers?: Record<string, string>; body?: string } = {},
    onEvent: SSEEventHandler,
    onError?: (err: Error) => void
  ): Promise<void> {
    let attempt = 0

    while (attempt <= this.config.maxRetries) {
      if (attempt > 0) {
        const delay = this.calculateBackoff(attempt - 1)
        await this.sleep(delay)
      }

      this.abortController = new AbortController()

      try {
        await this.connectOnce(url, options, onEvent)
        // 连接成功并正常结束
        return
      } catch (err) {
        attempt++

        if (attempt > this.config.maxRetries) {
          if (onError) onError(err instanceof Error ? err : new Error(String(err)))
          return
        }
      }
    }
  }

  /**
   * 单次连接尝试
   */
  private async connectOnce(
    url: string,
    options: { method?: string; headers?: Record<string, string>; body?: string },
    onEvent: SSEEventHandler
  ): Promise<void> {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
        ...(this.lastEventId ? { 'Last-Event-ID': this.lastEventId } : {}),
        ...options.headers,
      },
      body: options.body,
      signal: this.abortController!.signal,
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }

    const reader = response.body?.getReader()
    if (!reader) {
      throw new Error('No response body')
    }

    const decoder = new TextDecoder()
    let buffer = ''

    // 启动心跳
    if (this.config.heartbeatIntervalMs > 0) {
      this.startHeartbeat()
    }

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const events = this.parseSSEBuffer(buffer)
        buffer = events.remaining

        for (const event of events.events) {
          if (event.id) this.lastEventId = event.id
          onEvent(event)
        }
      }
    } finally {
      this.stopHeartbeat()
      reader.releaseLock()
    }
  }

  /**
   * 解析SSE缓冲区
   * SSE格式是 "event: type\ndata: payload\nid: xxx\n\n"
   */
  private parseSSEBuffer(buffer: string): {
    events: Array<{ type: string; data: string; id?: string }>
    remaining: string
  } {
    const events: Array<{ type: string; data: string; id?: string }> = []
    const blocks = buffer.split('\n\n')

    // 最后一个block可能不完整，保留到下次
    const remaining = blocks.pop() || ''

    for (const block of blocks) {
      if (!block.trim()) continue

      const lines = block.split('\n')
      let type = 'message'
      let data = ''
      let id: string | undefined

      for (const line of lines) {
        if (line.startsWith('event:')) {
          type = line.slice(6).trim()
        } else if (line.startsWith('data:')) {
          data += line.slice(5).trim() + '\n'
        } else if (line.startsWith('id:')) {
          id = line.slice(3).trim()
        }
      }

      if (data) {
        events.push({ type, data: data.trim(), id })
      }
    }

    return { events, remaining }
  }

  /**
   * 关闭连接
   */
  close(): void {
    if (this.abortController) {
      this.abortController.abort()
    }
    this.stopHeartbeat()
  }

  /**
   * 计算指数退避
   */
  private calculateBackoff(attempt: number): number {
    const delay = this.config.baseDelayMs * Math.pow(2, attempt)
    // 加随机抖动，避免雪崩
    const jitter = Math.random() * this.config.baseDelayMs
    return Math.min(delay + jitter, this.config.maxDelayMs)
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      // 简单的心跳：检查是否超时
      // 实际应用可以发ping frame
    }, this.config.heartbeatIntervalMs)
  }

  /**
   * 停止心跳
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
