import { describe, it, expect } from 'vitest'
import { AgentOrchestrator, AgentRegistry } from './orchestrator'
import { BaseAgent, type AgentThought, type AgentResult } from './base'
import { createBufferMemory } from '../memory/buffer'

class MockAgent extends BaseAgent {
  protected async reason(_context: string): Promise<AgentThought> {
    return { reasoning: 'mock thought' }
  }
  protected async generateOutput(_thoughts: AgentThought[]): Promise<string> {
    return 'mock output'
  }
  async execute(task: string): Promise<AgentResult> {
    return {
      success: true,
      output: `processed: ${task}`,
      thoughts: [{ reasoning: 'mock' }],
      toolCalls: [],
      tokenUsage: 100,
    }
  }
}

describe('AgentOrchestrator', () => {
  it('should execute single task', async () => {
    const registry = new AgentRegistry()
    const memory = createBufferMemory('user-1', 'session-1')
    const agent = new MockAgent({
      name: 'mock',
      systemPrompt: 'test',
      maxIterations: 1,
      temperature: 0.3,
      maxTokens: 100,
    }, memory)
    registry.register('mock-agent', agent)

    const orchestrator = new AgentOrchestrator(registry)
    const result = await orchestrator.execute([
      { id: 'task-1', agentId: 'mock-agent', input: 'test', mode: 'serial' },
    ])

    expect(result.success).toBe(true)
    expect(result.results.size).toBe(1)
    expect(result.executionOrder).toContain('task-1')
  })

  it('should detect circular dependency', async () => {
    const registry = new AgentRegistry()
    const memory = createBufferMemory('user-1', 'session-1')
    const agent = new MockAgent({
      name: 'mock',
      systemPrompt: 'test',
      maxIterations: 1,
      temperature: 0.3,
      maxTokens: 100,
    }, memory)
    registry.register('mock-agent', agent)

    const orchestrator = new AgentOrchestrator(registry)

    await expect(orchestrator.execute([
      { id: 'task-a', agentId: 'mock-agent', input: 'a', mode: 'dag', dependsOn: ['task-b'] },
      { id: 'task-b', agentId: 'mock-agent', input: 'b', mode: 'dag', dependsOn: ['task-a'] },
    ])).rejects.toThrow('Circular dependency')
  })
})
