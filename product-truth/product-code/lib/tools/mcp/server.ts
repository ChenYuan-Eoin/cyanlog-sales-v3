// lib/tools/mcp/server.ts
// MCP Server — 实现MCP协议服务端
// MCP是"工具的USB接口"，统一了不同LLM调用工具的方式

import type { MCPTool, MCPRequest, MCPResponse, MCPResource, MCPPrompt, MCPServerCapabilities } from './types'
import { MCP_METHODS } from './types'
import { handleToolsList, handleToolsCall } from './handlers'

/**
 * MCP Server配置
 */
export interface MCPServerConfig {
  name: string
  version: string
  capabilities?: MCPServerCapabilities
}

/**
 * MCP Server
 * Server负责"暴露能力"，Client负责"调用能力"
 * 这和"API网关"的思路是一样的
 */
export class MCPServer {
  private config: MCPServerConfig
  private tools: Map<string, MCPTool> = new Map()
  private resources: Map<string, MCPResource> = new Map()
  private prompts: Map<string, MCPPrompt> = new Map()

  constructor(config: MCPServerConfig) {
    this.config = config
  }

  /**
   * 注册工具
   */
  registerTool(tool: MCPTool): void {
    this.tools.set(tool.name, tool)
  }

  /**
   * 注册资源
   */
  registerResource(resource: MCPResource): void {
    this.resources.set(resource.uri, resource)
  }

  /**
   * 注册Prompt模板
   */
  registerPrompt(prompt: MCPPrompt): void {
    this.prompts.set(prompt.name, prompt)
  }

  /**
   * 处理MCP请求
   */
  async handleRequest(request: MCPRequest): Promise<MCPResponse> {
    try {
      switch (request.method) {
        case MCP_METHODS.INITIALIZE:
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              protocolVersion: '2024-11-05',
              serverInfo: {
                name: this.config.name,
                version: this.config.version,
              },
              capabilities: this.config.capabilities || { tools: {} },
            },
          }

        case MCP_METHODS.TOOLS_LIST:
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: handleToolsList(this.tools),
          }

        case MCP_METHODS.TOOLS_CALL:
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: await handleToolsCall(request.params, this.tools),
          }

        case MCP_METHODS.RESOURCES_LIST:
          return {
            jsonrpc: '2.0',
            id: request.id,
            result: {
              resources: Array.from(this.resources.values()),
            },
          }

        default:
          return {
            jsonrpc: '2.0',
            id: request.id,
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`,
            },
          }
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      }
    }
  }
}
