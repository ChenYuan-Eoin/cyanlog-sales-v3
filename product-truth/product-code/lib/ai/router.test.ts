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
  it('taskTypeStrategy: classify should go to the deterministic compare/rule stage', async () => {
    const result = await taskTypeStrategy.select('classify', {
      pageCount: 5,
      userRiskSensitivity: 0.5,
      providerHealth: { local: true, cloud: true },
      currentLoad: { local: 1, cloud: 1 },
      costBudget: 1.0,
    })
    expect(result).toBe('stage:template_compare')
  })

  it('userProfileStrategy: high sensitivity should go to cloud', async () => {
    const result = await userProfileStrategy.select('semantic', {
      pageCount: 5,
      userRiskSensitivity: 0.9,
      providerHealth: { local: true, cloud: true },
      currentLoad: { local: 1, cloud: 1 },
      costBudget: 1.0,
    })
    expect(result).toBe('pool:cloud')
  })

  it('costStrategy: low budget should go to rule-engine', async () => {
    const result = await costStrategy.select('semantic', {
      pageCount: 5,
      userRiskSensitivity: 0.5,
      providerHealth: { local: true, cloud: true },
      currentLoad: { local: 1, cloud: 1 },
      costBudget: 0.1,
    })
    expect(result).toBe('executor:rule-engine')
  })

  it('loadBalanceStrategy: should pick less loaded provider', async () => {
    const result = await loadBalanceStrategy.select('semantic', {
      pageCount: 5,
      userRiskSensitivity: 0.5,
      providerHealth: { local: true, cloud: true },
      currentLoad: { local: 1, cloud: 5 },
      costBudget: 1.0,
    })
    expect(result).toBe('pool:local')
  })

  it('taskTypeStrategy: contract review starts from the semantic review capability pool', async () => {
    const result = await taskTypeStrategy.select('contract_review', {
      pageCount: 8,
      userRiskSensitivity: 0.5,
      providerHealth: { local: true, cloud: true },
      currentLoad: { local: 1, cloud: 1 },
      costBudget: 1.0,
    })
    expect(result).toBe('stage:semantic_review')
  })

  it('taskTypeStrategy: long tender parsing starts from the long-document capability pool', async () => {
    const result = await taskTypeStrategy.select('tender_long_document_parse', {
      pageCount: 180,
      userRiskSensitivity: 0.5,
      providerHealth: { local: true, cloud: true },
      currentLoad: { local: 1, cloud: 1 },
      costBudget: 1.0,
    })
    expect(result).toBe('stage:tender_long_document_parse')
  })

  it('taskTypeStrategy: published strategy rules can override the default task target', async () => {
    const result = await taskTypeStrategy.select('contract_review', {
      pageCount: 60,
      userRiskSensitivity: 0.8,
      providerHealth: { local: true, cloud: true },
      currentLoad: { local: 1, cloud: 1 },
      costBudget: 1.0,
      strategyRules: [
        {
          id: 'sensitive-long-contract-cloud',
          taskTypes: ['contract_review'],
          minPages: 30,
          minRiskSensitivity: 0.7,
          target: 'pool:cloud',
        },
      ],
    })
    expect(result).toBe('pool:cloud')
  })
})
