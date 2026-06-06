import { describe, it, expect } from 'vitest'
import { ContractReviewAgent } from './skills/contract-review'
import { createBufferMemory } from '../memory/buffer'

describe('ContractReviewAgent', () => {
  it('should create agent with tools', () => {
    const memory = createBufferMemory('user-1', 'session-1')
    const agent = new ContractReviewAgent(memory)
    expect(agent).toBeDefined()
  })
})
