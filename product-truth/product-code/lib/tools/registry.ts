// lib/tools/registry.ts
// 工具注册中心 — 运行时注册/发现
// 注册中心是平台能力的核心，第三方可以动态注册工具

import type { BaseTool } from './base'

/**
 * 工具注册中心
 */
export class ToolRegistry {
  private tools: Map<string, BaseTool<unknown, unknown>> = new Map()

  /**
   * 注册工具
   */
  register<P, R>(tool: BaseTool<P, R>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool ${tool.name} already registered`)
    }
    this.tools.set(tool.name, tool as BaseTool<unknown, unknown>)
  }

  /**
   * 注销工具
   */
  unregister(name: string): boolean {
    return this.tools.delete(name)
  }

  /**
   * 获取工具
   */
  get(name: string): BaseTool | undefined {
    return this.tools.get(name)
  }

  /**
   * 列出所有工具
   */
  list(): BaseTool[] {
    return Array.from(this.tools.values())
  }

  /**
   * 按权限过滤工具
   */
  listByPermission(userPermissions: string[]): BaseTool[] {
    return this.list().filter((tool) => {
      if (!tool.requiredPermission) return true
      return userPermissions.includes(tool.requiredPermission) || userPermissions.includes('*')
    })
  }

  /**
   * 执行工具（带权限校验）
   */
  async execute(
    name: string,
    params: unknown,
    userPermissions: string[] = ['*']
  ): Promise<unknown> {
    const tool = this.get(name)
    if (!tool) {
      throw new Error(`Tool not found: ${name}`)
    }

    // 权限校验
    if (tool.requiredPermission && !userPermissions.includes(tool.requiredPermission) && !userPermissions.includes('*')) {
      throw new Error(`Permission denied: ${tool.requiredPermission} required`)
    }

    // 参数校验
    const validated = tool.parameters.parse(params)

    // 执行
    return await tool.execute(validated)
  }
}

/**
 * 全局工具注册中心实例
 */
export const globalToolRegistry = new ToolRegistry()
