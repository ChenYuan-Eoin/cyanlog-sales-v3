import { describe, it, expect } from 'vitest'
import { calculateConfidence } from './confidence-scorer'

describe('calculateConfidence', () => {
  it('should return low confidence for invalid JSON', () => {
    const result = calculateConfidence('invalid json')
    expect(result.overall).toBe(0.3)
    expect(result.recommendation).toBe('reject')
  })

  it('should return high confidence for valid output', () => {
    const validOutput = JSON.stringify({
      risks: [
        {
          level: 'red',
          title: '账期过长',
          description: '合同第3条约定账期为120天，超过标准90天',
          suggestion: '建议缩短至60天',
        },
      ],
      summary: '合同存在账期过长的风险，建议缩短账期',
    })

    const result = calculateConfidence(validOutput)
    expect(result.overall).toBeGreaterThan(0.5)
    expect(result.dimensions.formatCompliance).toBe(1.0)
  })

  it('should detect low content consistency', () => {
    const inconsistentOutput = JSON.stringify({
      risks: [
        {
          level: 'red',
          title: '违约金过高',
          description: '违约金比例为10%',
          suggestion: '建议降低',
        },
      ],
      summary: '合同整体无重大风险', // 摘要未提及违约金
    })

    const result = calculateConfidence(inconsistentOutput)
    expect(result.dimensions.contentConsistency).toBeLessThan(0.5)
  })
})
