import { describe, it, expect } from 'vitest'
import { Arbitrator, type ModelResult } from './arbitration'
import type { SyncReviewResult } from './failover'

function makeResult(
  provider: string,
  risks: Array<{ level: 'red' | 'yellow' | 'green'; title: string; description: string; suggestion: string }>,
  degraded = false
): ModelResult {
  return {
    provider,
    result: {
      risks,
      summary: `summary from ${provider}`,
      provider,
      model: `${provider}-model`,
      providerKind: provider === 'rule-engine' ? 'builtin' : 'openai_compatible',
      degraded,
    },
  }
}

describe('Arbitrator consistency calculation', () => {
  it('should return 1.0 for single result', () => {
    const arbitrator = new Arbitrator()
    const results = [makeResult('local', [])]
    const score = (arbitrator as unknown as { calculateConsistency: (r: ModelResult[]) => number }).calculateConsistency(results)
    expect(score).toBe(1.0)
  })

  it('should return high score for consistent results', () => {
    const arbitrator = new Arbitrator()
    const results = [
      makeResult('local', [{ level: 'red', title: 'a', description: 'a', suggestion: 'a' }]),
      makeResult('cloud', [{ level: 'red', title: 'b', description: 'b', suggestion: 'b' }]),
    ]
    const score = (arbitrator as unknown as { calculateConsistency: (r: ModelResult[]) => number }).calculateConsistency(results)
    expect(score).toBeGreaterThan(0.5)
  })

  it('should return low score for inconsistent results', () => {
    const arbitrator = new Arbitrator()
    const results = [
      makeResult('local', []),
      makeResult('cloud', Array(5).fill({ level: 'red', title: 'a', description: 'a', suggestion: 'a' })),
    ]
    const score = (arbitrator as unknown as { calculateConsistency: (r: ModelResult[]) => number }).calculateConsistency(results)
    expect(score).toBeLessThan(0.5)
  })
})

describe('Arbitrator strategies', () => {
  it('should use majority vote', () => {
    const arbitrator = new Arbitrator()
    arbitrator.setStrategy('majority_vote')
    const results = [makeResult('local', [])]
    const final = (arbitrator as unknown as { majorityVote: (r: ModelResult[]) => SyncReviewResult }).majorityVote(results)
    expect(final.provider).toBe('local')
  })

  it('should use weighted vote', () => {
    const arbitrator = new Arbitrator()
    const results = [
      { provider: 'local', result: makeResult('local', []).result, weight: 1 },
      { provider: 'cloud', result: makeResult('cloud', []).result, weight: 3 },
    ]
    const final = (arbitrator as unknown as { weightedVote: (r: ModelResult[]) => SyncReviewResult }).weightedVote(results)
    expect(final.provider).toBe('cloud')
  })

  it('should use confidence threshold', () => {
    const arbitrator = new Arbitrator()
    const results = [
      makeResult('local', [], true),
      makeResult('cloud', []),
    ]
    const final = (arbitrator as unknown as { confidenceThreshold: (r: ModelResult[]) => SyncReviewResult }).confidenceThreshold(results)
    expect(final.degraded).toBe(false)
  })
})
