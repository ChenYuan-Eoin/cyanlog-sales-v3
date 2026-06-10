// lib/agent/orchestrator.ts
// Agent编排器 — 支持串行/并行/DAG调度
// 编排器负责"调度"，Agent负责"执行"

import type { BaseAgent, AgentResult } from './base'

/**
 * Agent执行模式
 */
export type ExecutionMode = 'serial' | 'parallel' | 'dag'

/**
 * 编排任务节点
 */
export interface OrchestratorTask {
  id: string
  agentId: string
  input: string
  /** 依赖任务ID（用于DAG） */
  dependsOn?: string[]
  /** 执行模式 */
  mode: ExecutionMode
}

/**
 * 编排结果
 */
export interface OrchestratorResult {
  success: boolean
  results: Map<string, AgentResult>
  /** 总耗时ms */
  duration: number
  /** 执行顺序（用于追踪） */
  executionOrder: string[]
}

/**
 * Agent注册表
 */
export class AgentRegistry {
  private agents: Map<string, BaseAgent> = new Map()

  register(id: string, agent: BaseAgent): void {
    this.agents.set(id, agent)
  }

  get(id: string): BaseAgent | undefined {
    return this.agents.get(id)
  }

  list(): string[] {
    return Array.from(this.agents.keys())
  }
}

/**
 * Agent编排器
 * 串行：上一个Agent的输出是下一个Agent的输入
 * 并行：多个Agent独立执行，结果合并
 * DAG：按依赖关系拓扑排序执行
 */
export class AgentOrchestrator {
  private registry: AgentRegistry

  constructor(registry: AgentRegistry = new AgentRegistry()) {
    this.registry = registry
  }

  /**
   * 执行编排任务
   */
  async execute(tasks: OrchestratorTask[]): Promise<OrchestratorResult> {
    const start = Date.now()
    const results = new Map<string, AgentResult>()
    const executionOrder: string[] = []

    // 按依赖关系分组
    const readyTasks = tasks.filter((t) => !t.dependsOn || t.dependsOn.length === 0)
    const dependentTasks = tasks.filter((t) => t.dependsOn && t.dependsOn.length > 0)

    // 第一阶段：执行无依赖任务
    await this.executeReadyTasks(readyTasks, results, executionOrder)

    // 第二阶段：按依赖顺序执行
    let remaining = [...dependentTasks]
    while (remaining.length > 0) {
      const canExecute = remaining.filter((t) =>
        t.dependsOn!.every((dep) => results.has(dep))
      )

      if (canExecute.length === 0) {
        // 死锁检测：存在循环依赖
        throw new Error('Circular dependency detected')
      }

      await this.executeReadyTasks(canExecute, results, executionOrder)
      remaining = remaining.filter((t) => !results.has(t.id))
    }

    return {
      success: true,
      results,
      duration: Date.now() - start,
      executionOrder,
    }
  }

  /**
   * 执行可执行任务（区分串行/并行）
   */
  private async executeReadyTasks(
    tasks: OrchestratorTask[],
    results: Map<string, AgentResult>,
    executionOrder: string[]
  ): Promise<void> {
    // 按模式分组
    const serialTasks = tasks.filter((t) => t.mode === 'serial')
    const parallelTasks = tasks.filter((t) => t.mode === 'parallel')
    const dagTasks = tasks.filter((t) => t.mode === 'dag')

    // 并行任务并发执行
    if (parallelTasks.length > 0) {
      const promises = parallelTasks.map((task) => this.executeTask(task, results))
      await Promise.all(promises)
      parallelTasks.forEach((t) => executionOrder.push(t.id))
    }

    // 串行任务顺序执行
    for (const task of serialTasks) {
      await this.executeTask(task, results)
      executionOrder.push(task.id)
    }

    // DAG任务（DAG模式下，依赖关系已经处理好，直接执行）
    for (const task of dagTasks) {
      await this.executeTask(task, results)
      executionOrder.push(task.id)
    }
  }

  /**
   * 执行单个任务
   */
  private async executeTask(
    task: OrchestratorTask,
    results: Map<string, AgentResult>
  ): Promise<void> {
    const agent = this.registry.get(task.agentId)
    if (!agent) {
      throw new Error(`Agent not found: ${task.agentId}`)
    }

    // 如果有依赖，合并依赖任务的输出作为输入
    let input = task.input
    if (task.dependsOn && task.dependsOn.length > 0) {
      const depResults = task.dependsOn
        .map((depId) => results.get(depId))
        .filter((r): r is AgentResult => r !== undefined)
      input += '\n\n依赖任务结果：\n' +
        depResults.map((r, i) => `[${task.dependsOn![i]}]: ${r.output}`).join('\n')
    }

    const result = await agent.execute(input)
    results.set(task.id, result)
  }
}
