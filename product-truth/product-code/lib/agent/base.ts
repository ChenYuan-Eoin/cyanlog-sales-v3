// lib/agent/base.ts
// Agent基类 — ReAct循环（Reasoning + Acting）
// ReAct = Reasoning（思考）+ Acting（行动）+ Observation（观察）

import type { BaseMemory } from '@/lib/memory/base'
import { generateMessageId, estimateTokens } from '@/lib/memory/base'

/**
 * Agent工具接口
 */
export interface AgentTool {
  name: string
  description: string
  parameters: Record<string, unknown>
  execute: (params: Record<string, unknown>) => Promise<unknown>
}

/**
 * Agent思考结果
 */
export interface AgentThought {
  reasoning: string
  action?: {
    tool: string
    parameters: Record<string, unknown>
  }
  observation?: string
}

/**
 * Agent执行结果
 */
export interface AgentResult {
  success: boolean
  output: string
  thoughts: AgentThought[]
  toolCalls: Array<{ tool: string; result: unknown }>
  tokenUsage: number
}

/**
 * Agent配置
 */
export interface AgentConfig {
  name: string
  systemPrompt: string
  maxIterations: number
  temperature: number
  maxTokens: number
}

/**
 * BaseAgent — ReAct循环实现
 * 每轮循环：LLM生成思考 → 决定行动 → 执行工具 → 观察结果 → 进入下一轮
 * 直到达成目标或达到最大迭代次数
 */
export abstract class BaseAgent {
  protected config: AgentConfig
  protected memory: BaseMemory
  protected tools: Map<string, AgentTool> = new Map()

  constructor(config: AgentConfig, memory: BaseMemory) {
    this.config = config
    this.memory = memory
  }

  /**
   * 注册工具
   */
  registerTool(tool: AgentTool): void {
    this.tools.set(tool.name, tool)
  }

  /**
   * 执行Agent任务 — ReAct循环核心
   */
  async execute(task: string): Promise<AgentResult> {
    const thoughts: AgentThought[] = []
    const toolCalls: Array<{ tool: string; result: unknown }> = []
    let totalTokens = 0

    // 初始化系统消息
    await this.memory.save({
      id: generateMessageId(),
      role: 'system',
      content: this.config.systemPrompt,
      timestamp: Date.now(),
      tokenCount: estimateTokens(this.config.systemPrompt),
    })

    // 添加用户任务
    await this.memory.save({
      id: generateMessageId(),
      role: 'user',
      content: task,
      timestamp: Date.now(),
      tokenCount: estimateTokens(task),
    })

    for (let iteration = 0; iteration < this.config.maxIterations; iteration++) {
      // Step 1: 加载上下文（包含历史思考和观察）
      const context = await this.memory.load(20)
      const contextText = context.map((m) => `${m.role}: ${m.content}`).join('\n')

      // Step 2: 生成思考（Reasoning）
      const thought = await this.reason(contextText)
      thoughts.push(thought)

      totalTokens += estimateTokens(thought.reasoning)

      // Step 3: 如果有行动，执行工具（Acting）
      if (thought.action) {
        const tool = this.tools.get(thought.action.tool)
        if (!tool) {
          thoughts.push({
            reasoning: `工具 ${thought.action.tool} 未找到`,
            observation: '工具不存在',
          })
          continue
        }

        try {
          const result = await tool.execute(thought.action.parameters)
          toolCalls.push({ tool: thought.action.tool, result })

          // Step 4: 观察结果（Observation）
          const observation = this.formatObservation(result)
          thoughts.push({
            reasoning: thought.reasoning,
            action: thought.action,
            observation,
          })

          // 保存到记忆
          await this.memory.save({
            id: generateMessageId(),
            role: 'tool',
            content: `[${thought.action.tool}] ${observation}`,
            timestamp: Date.now(),
            metadata: { tool: thought.action.tool, result },
          })
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err)
          thoughts.push({
            reasoning: thought.reasoning,
            action: thought.action,
            observation: `执行失败: ${errorMsg}`,
          })
        }
      } else {
        // 没有行动，说明Agent已经得出结论
        break
      }
    }

    // 生成最终输出
    const finalOutput = await this.generateOutput(thoughts)
    totalTokens += estimateTokens(finalOutput)

    return {
      success: true,
      output: finalOutput,
      thoughts,
      toolCalls,
      tokenUsage: totalTokens,
    }
  }

  /**
   * 思考步骤 — 由子类实现（调用LLM）
   * 这是ReAct循环的核心，决定Agent的"智能"程度
   */
  protected abstract reason(context: string): Promise<AgentThought>

  /**
   * 生成最终输出 — 由子类实现
   */
  protected abstract generateOutput(thoughts: AgentThought[]): Promise<string>

  /**
   * 格式化观察结果
   */
  private formatObservation(result: unknown): string {
    if (typeof result === 'string') return result
    try {
      return JSON.stringify(result, null, 2)
    } catch {
      return String(result)
    }
  }
}
