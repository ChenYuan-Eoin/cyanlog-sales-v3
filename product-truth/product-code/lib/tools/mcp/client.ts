// lib/tools/mcp/client.ts
// MCP Client — 连接外部MCP服务
// Client让我们的Agent可以调用外部服务的能力

import type { MCPRequest, MCPResponse } from './types'

/**
 * MCP Client配置
 */
export interface MCPClientConfig {
  /** Server URL (for SSE transport) */
  url: string
  /** 传输方式 */
  transport: 'sse' | 'stdio'
  /** 超时ms */
  timeoutMs?: number
}

/**
 * MCP Client
 */
export class MCPClient {
  private config: MCPClientConfig

  constructor(config: MCPClientConfig) {
    this.config = config
  }

  /**
   * 发送请求到MCP Server
   */
  async request(method: string, params?: unknown): Promise<unknown> {
    const request: MCPRequest = {
      jsonrpc: '2.0',
      id: Math.random().toString(36).substring(2, 9),
      method,
      params,
    }

    if (this.config.transport === 'sse') {
      return this.sendViaSSE(request)
    }

    // stdio 传输（命令行场景）
    throw new Error('stdio transport not implemented yet')
  }

  /**
   * 通过SSE发送请求
   */
  private async sendViaSSE(request: MCPRequest): Promise<unknown> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs || 30000)

    try {
      const response = await fetch(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const result = (await response.json()) as MCPResponse
      if (result.error) {
        throw new Error(`MCP error: ${result.error.message}`)
      }
      return result.result
    } finally {
      clearTimeout(timeout)
    }
  }

  /**
   * 列出Server的工具
   */
  async listTools(): Promise<unknown> {
    return this.request('tools/list')
  }

  /**
   * 调用工具
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request('tools/call', { name, arguments: args })
  }
}
