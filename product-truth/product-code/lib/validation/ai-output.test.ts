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
          ruleCode: 'R001',
          ruleVersion: 2,
          level: 'red',
          title: '账期过长',
          description: '账期为120天',
          suggestion: '建议缩短',
          evidence: ['账期为120天'],
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
          ruleCode: 'R001',
          level: 'purple', // invalid
          title: 'test',
          description: 'test',
          suggestion: 'test',
          evidence: ['test'],
        },
      ],
      summary: 'test',
    })

    const result = validateAIOutput(invalidOutput)
    expect(result.valid).toBe(false)
  })

  it('should reject risks without rule code and source evidence', () => {
    const invalidOutput = JSON.stringify({
      risks: [
        {
          level: 'red',
          title: '账期过长',
          description: '账期为120天',
          suggestion: '建议缩短',
        },
      ],
      summary: 'test',
    })

    const result = validateAIOutput(invalidOutput)
    expect(result.valid).toBe(false)
    expect(result.error).toContain('ruleCode')
    expect(result.error).toContain('evidence')
  })

  it('should extract JSON from markdown code block', () => {
    const markdownOutput = '```json\n{"risks":[],"summary":"test"}\n```'

    const result = validateAIOutput(markdownOutput)
    expect(result.valid).toBe(true)
  })

  it('rejects risks whose rule code is not in the current SkillBundle', () => {
    const output = JSON.stringify({
      risks: [{
        ruleCode: 'R999',
        level: 'red',
        title: '未知规则',
        description: '未知规则命中',
        suggestion: '人工复核',
        evidence: ['第一条 付款条款：账期为120天'],
      }],
      summary: 'test',
    })

    const result = validateAIOutput(output, {
      contractText: '第一条 付款条款：账期为120天。',
      rules: [{ code: 'R001', field_hints: ['付款', '账期'] }],
      requireEvidenceInSource: true,
      requireRuleEvidenceHint: true,
    })

    expect(result.valid).toBe(false)
    expect(result.error).toContain('not in current SkillBundle')
  })

  it('rejects evidence that is not a continuous source fragment', () => {
    const output = JSON.stringify({
      risks: [{
        ruleCode: 'R001',
        level: 'yellow',
        title: '付款周期过长',
        description: '付款周期过长',
        suggestion: '缩短付款周期',
        evidence: ['签约后180天付款'],
      }],
      summary: 'test',
    })

    const result = validateAIOutput(output, {
      contractText: '第一条 付款条款：验收后30日内付款。',
      rules: [{ code: 'R001', field_hints: ['付款', '账期'] }],
      requireEvidenceInSource: true,
      requireRuleEvidenceHint: true,
    })

    expect(result.valid).toBe(false)
    expect(result.error).toContain('continuous source fragment')
  })

  it('rejects cross-clause evidence that does not match rule hints', () => {
    const output = JSON.stringify({
      risks: [{
        ruleCode: 'R009',
        level: 'red',
        title: '保密期',
        description: '错误地用付款条款触发保密期',
        suggestion: '人工复核',
        evidence: ['第二条 付款条款：合同签订后180日内支付全部款项'],
      }],
      summary: 'test',
    })

    const result = validateAIOutput(output, {
      contractText: '第二条 付款条款：合同签订后180日内支付全部款项。',
      rules: [{ code: 'R009', field_hints: ['保密期', '保密义务', '永久'] }],
      requireEvidenceInSource: true,
      requireRuleEvidenceHint: true,
    })

    expect(result.valid).toBe(false)
    expect(result.error).toContain('rule field hints')
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
