// lib/tools/base.ts
// 工具基类 — Function Calling标准化
// 工具是Agent能力的扩展，标准化的工具接口让LLM可调用

import { type ZodSchema } from 'zod'

/**
 * 工具定义
 */
export interface BaseTool<P = unknown, R = unknown> {
  /** 工具名称（唯一） */
  name: string
  /** 工具描述（给LLM看的） */
  description: string
  /** 参数Schema（Zod） */
  parameters: ZodSchema<P>
  /** 执行函数 */
  execute: (params: P) => Promise<R>
  /** 可选：权限要求 */
  requiredPermission?: string
}

/**
 * 工具执行结果
 */
export interface ToolResult<R = unknown> {
  success: boolean
  data?: R
  error?: string
}

/**
 * 创建工具的工厂函数
 */
export function createTool<P, R>(config: {
  name: string
  description: string
  parameters: ZodSchema<P>
  execute: (params: P) => Promise<R>
  requiredPermission?: string
}): BaseTool<P, R> {
  return {
    name: config.name,
    description: config.description,
    parameters: config.parameters,
    execute: config.execute,
    requiredPermission: config.requiredPermission,
  }
}

/**
 * 工具转JSON Schema（用于Function Calling）
 */
export function toolToJsonSchema(tool: BaseTool): {
  name: string
  description: string
  parameters: Record<string, unknown>
} {
  return {
    name: tool.name,
    description: tool.description,
    parameters: zodToJsonSchema(),
  }
}

/**
 * Zod Schema → JSON Schema（简化版）
 * 实际应用应该用 zod-to-json-schema 库，这里简化实现
 */
function zodToJsonSchema(): Record<string, unknown> {
  return {
    type: 'object',
    properties: {},
  }
}
