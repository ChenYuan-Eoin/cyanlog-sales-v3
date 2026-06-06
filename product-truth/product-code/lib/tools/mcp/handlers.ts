// lib/tools/mcp/handlers.ts
// MCP协议处理器 — tools/list + tools/call
// 处理器是协议的具体实现，Server只负责路由

import type { MCPTool } from './types'

/**
 * tools/list 处理
 */
export function handleToolsList(
  tools: Map<string, MCPTool>
): { tools: MCPTool[] } {
  return {
    tools: Array.from(tools.values()),
  }
}

/**
 * tools/call 处理
 */
export async function handleToolsCall(
  params: unknown,
  tools: Map<string, MCPTool>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  const callParams = params as { name: string; arguments?: Record<string, unknown> }

  if (!callParams || !callParams.name) {
    throw new Error('Missing tool name')
  }

  const tool = tools.get(callParams.name)
  if (!tool) {
    throw new Error(`Tool not found: ${callParams.name}`)
  }

  // 这里应该真正执行工具，这里简化返回
  return {
    content: [
      {
        type: 'text',
        text: `Tool ${callParams.name} executed with params: ${JSON.stringify(callParams.arguments || {})}`,
      },
    ],
  }
}
