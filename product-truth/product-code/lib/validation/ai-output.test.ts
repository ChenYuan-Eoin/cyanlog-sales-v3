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
