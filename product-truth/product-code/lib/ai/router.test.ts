import { describe, it, expect } from 'vitest'
import { SmartRouter } from './router'
import { taskTypeStrategy, userProfileStrategy, costStrategy, loadBalanceStrategy } from './strategy'

describe('SmartRouter', () => {
  it('should create router with default strategy', () => {
    const router = new SmartRouter()
    expect(router).toBeDefined()
  })

  it('should set custom strategy', () => {
    const router = new SmartRouter()
    router.setStrategy(costStrategy)
    expect(router).toBeDefined()
  })
})

describe('Routing strategies', () => {
  it('taskTypeStrategy: classify should go to rule-engine', async () => {
    const result = await taskTypeStrategy.select('classify', {
      pageCount: 5,
      userRiskSensitivity: 0.5,
      providerHealth: { local: true, cloud: true },
      currentLoad: { local: 1, cloud: 1 },
      costBudget: 1.0,
    })
    expect(result).toBe('rule-engine')
  })

  it('userProfileStrategy: high sensitivity should go to cloud', async () => {
    const result = await userProfileStrategy.select('semantic', {
      pageCount: 5,
      userRiskSensitivity: 0.9,
      providerHealth: { local: true, cloud: true },
      currentLoad: { local: 1, cloud: 1 },
      costBudget: 1.0,
    })
    expect(result).toBe('cloud')
  })

  it('costStrategy: low budget should go to rule-engine', async () => {
    const result = await costStrategy.select('semantic', {
      pageCount: 5,
      userRiskSensitivity: 0.5,
      providerHealth: { local: true, cloud: true },
      currentLoad: { local: 1, cloud: 1 },
      costBudget: 0.1,
    })
    expect(result).toBe('rule-engine')
  })

  it('loadBalanceStrategy: should pick less loaded provider', async () => {
    const result = await loadBalanceStrategy.select('semantic', {
      pageCount: 5,
      userRiskSensitivity: 0.5,
      providerHealth: { local: true, cloud: true },
      currentLoad: { local: 1, cloud: 5 },
      costBudget: 1.0,
    })
    expect(result).toBe('local')
  })
})
