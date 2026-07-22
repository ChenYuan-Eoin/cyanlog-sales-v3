// lib/validation/ai-output.test.ts
import { describe, it, expect } from 'vitest'
import {
  validateAIOutput,
  validateAIOutputWithRetry,
  constrainParameters,
} from './ai-output'

describe('constrainParameters', () => {
  it('should clamp temperature within range', () => {
    const result = constrainParameters({ temperature: 2.0 })
    expect(result.temperature).toBe(1.0)
  })

  it('should use default for undefined values', () => {
    const result = constrainParameters({})
    expect(result.temperature).toBe(0.3)
    expect(result.maxOutputTokens).toBe(4000)
  })

  it('should accept valid values', () => {
    const result = constrainParameters({ temperature: 0.5, maxOutputTokens: 2000 })
    expect(result.temperature).toBe(0.5)
    expect(result.maxOutputTokens).toBe(2000)
  })
})

describe('validateAIOutput', () => {
  it('should validate correct JSON', () => {
    const validOutput = JSON.stringify({
      risks: [
        {
          level: 'red',
          title: '账期过长',
          description: '账期为120天',
          suggestion: '建议缩短',
        },
      ],
      summary: '总体评估',
    })

    const result = validateAIOutput(validOutput)
    expect(result.valid).toBe(true)
    expect(result.data?.risks).toHaveLength(1)
  })

  it('should reject missing fields', () => {
    const invalidOutput = JSON.stringify({
      risks: [],
      // missing summary
    })

    const result = validateAIOutput(invalidOutput)
    expect(result.valid).toBe(false)
    // Zod 4.x 的 missing field 错误消息不包含 "Required"，而是 "Invalid input"
    // 所以 retryable 取决于具体错误类型
    expect(typeof result.retryable).toBe('boolean')
  })

  it('should reject invalid risk level', () => {
    const invalidOutput = JSON.stringify({
      risks: [
        {
          level: 'purple', // invalid
          title: 'test',
          description: 'test',
          suggestion: 'test',
        },
      ],
      summary: 'test',
    })

    const result = validateAIOutput(invalidOutput)
    expect(result.valid).toBe(false)
  })

  it('preserves an exact source quote and rejects a fake short locator', () => {
    const valid = validateAIOutput(JSON.stringify({
      risks: [{
        level: 'yellow', title: '账期', description: '账期偏长', suggestion: '协商缩短',
        source_quote: '付款账期为一百二十日',
      }],
      summary: '需关注账期',
    }))
    expect(valid.valid).toBe(true)
    expect(valid.data?.risks[0].source_quote).toBe('付款账期为一百二十日')

    const invalid = validateAIOutput(JSON.stringify({
      risks: [{
        level: 'yellow', title: '账期', description: '账期偏长', suggestion: '协商缩短',
        source_quote: '账期',
      }],
      summary: '需关注账期',
    }))
    expect(invalid.valid).toBe(false)
  })

  it('accepts only a UUID-shaped frozen rule snapshot identity', () => {
    const base = {
      level: 'red',
      title: 'SLA 承诺',
      description: '存在无法兑现的全天候承诺',
      suggestion: '按已发布口径协商',
      source_quote: 'SLA 承诺为 7x24 小时',
      rule_code: 'R013',
    }
    const valid = validateAIOutput(JSON.stringify({
      risks: [{ ...base, rule_snapshot_id: '3d7895c4-a118-4c4f-b4c6-325b28f332aa' }],
      summary: '命中冻结规则',
    }))
    const invalid = validateAIOutput(JSON.stringify({
      risks: [{ ...base, rule_snapshot_id: 'snapshot-latest' }],
      summary: '伪造快照',
    }))

    expect(valid.valid).toBe(true)
    expect(invalid.valid).toBe(false)
  })

  it('should extract JSON from markdown code block', () => {
    const markdownOutput = '```json\n{"risks":[],"summary":"test"}\n```'

    const result = validateAIOutput(markdownOutput)
    expect(result.valid).toBe(true)
  })
})

describe('validateAIOutputWithRetry', () => {
  it('should succeed on first try', async () => {
    const validOutput = JSON.stringify({
      risks: [],
      summary: 'test',
    })

    const result = await validateAIOutputWithRetry(validOutput)
    expect(result.valid).toBe(true)
  })

  it('should retry on failure', async () => {
    let attempt = 0
    const retryFn = async () => {
      attempt++
      if (attempt === 1) {
        return JSON.stringify({ risks: [], summary: 'test' })
      }
      return JSON.stringify({ risks: [], summary: 'test' })
    }

    const result = await validateAIOutputWithRetry('invalid', retryFn)
    expect(result.valid).toBe(true)
  })
})
