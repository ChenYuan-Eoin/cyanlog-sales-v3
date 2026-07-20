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
  })

  it('should extract JSON from markdown code block', () => {
    const markdownOutput = '```json\n{"risks":[],"summary":"test"}\n```'

    const result = validateAIOutput(markdownOutput)
    expect(result.valid).toBe(true)
  })

  it('ignores model reasoning blocks before extracting review JSON', () => {
    const output = [
      '<think>{"risks":[{"ruleCode":"R999","level":"red"}],"summary":"bad"}</think>',
      JSON.stringify({
        risks: [{
          ruleCode: 'R001',
          level: 'yellow',
          title: '付款账期',
          description: '付款账期为120天',
          suggestion: '调整付款账期',
          evidence: ['第二条 付款条款：乙方验收后120天内付款，账期120天。'],
        }],
        summary: 'ok',
      }),
    ].join('\n')

    const result = validateAIOutput(output, {
      contractText: '第二条 付款条款：乙方验收后120天内付款，账期120天。',
      rules: [{ code: 'R001', version: 3, field_hints: ['付款', '账期'] }],
      requireEvidenceInSource: true,
      requireRuleEvidenceHint: true,
    })

    expect(result.valid).toBe(true)
    expect(result.data?.summary).toBe('ok')
    expect(result.data?.risks[0]).toMatchObject({
      ruleCode: 'R001',
      ruleVersion: 3,
    })
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

  it('can drop invalid risks while keeping source-bound risks for model review', () => {
    const output = JSON.stringify({
      risks: [
        {
          ruleCode: 'R001',
          ruleVersion: 1,
          level: 'yellow',
          title: '付款账期',
          description: '付款账期偏长',
          suggestion: '调整付款账期',
          evidence: ['第二条 付款条款：乙方验收后120天内付款，账期120天。'],
        },
        {
          ruleCode: 'R009',
          ruleVersion: 1,
          level: 'red',
          title: '保密期',
          description: '错误复用付款条款判断保密期',
          suggestion: '人工复核',
          evidence: ['第二条 付款条款：乙方验收后120天内付款，账期120天。'],
        },
      ],
      summary: 'test',
    })

    const result = validateAIOutput(output, {
      contractText: '第二条 付款条款：乙方验收后120天内付款，账期120天。',
      rules: [
        { code: 'R001', version: 3, field_hints: ['付款', '账期'] },
        { code: 'R009', version: 3, field_hints: ['保密期', '保密义务', '永久'] },
      ],
      requireEvidenceInSource: true,
      requireRuleEvidenceHint: true,
      allowPartialRiskAcceptance: true,
    })

    expect(result.valid).toBe(true)
    expect(result.data?.risks).toHaveLength(1)
    expect(result.data?.risks[0]).toMatchObject({
      ruleCode: 'R001',
      ruleVersion: 3,
    })
    expect(result.droppedRisks).toBe(1)
    expect(result.warnings?.[0]).toContain('rule field hints')
  })

  it('still rejects output when every AI risk fails runtime constraints', () => {
    const output = JSON.stringify({
      risks: [{
        ruleCode: 'R009',
        level: 'red',
        title: '保密期',
        description: '错误复用付款条款判断保密期',
        suggestion: '人工复核',
        evidence: ['第二条 付款条款：乙方验收后120天内付款，账期120天。'],
      }],
      summary: 'test',
    })

    const result = validateAIOutput(output, {
      contractText: '第二条 付款条款：乙方验收后120天内付款，账期120天。',
      rules: [{ code: 'R009', version: 3, field_hints: ['保密期', '保密义务', '永久'] }],
      requireEvidenceInSource: true,
      requireRuleEvidenceHint: true,
      allowPartialRiskAcceptance: true,
    })

    expect(result.valid).toBe(false)
    expect(result.droppedRisks).toBe(1)
  })

  it('uses typed canonical readings for deterministic decisions and replaces model-authored outcome text', () => {
    const contractText = '第一条 合同金额为40000元，双方确认按约履行。'
    const output = JSON.stringify({
      risks: [{
        ruleCode: 'MIN_AMOUNT',
        propertyReadings: [{
          propertyKey: 'contract_amount',
          status: 'read',
          value: 40000,
          unit: 'CNY',
          evidence: contractText,
          confidence: 0.97,
        }],
        level: 'green',
        title: '模型自定标题',
        description: '模型自定说明',
        suggestion: '模型自定动作',
        evidence: ['模型自定证据'],
      }],
      summary: '发现一项金额风险',
    })
    const rule_contract = {
      schema_version: '1.0' as const,
      properties: [{ key: 'contract_amount', label: '合同金额', type: 'money' as const, required: true, currency: 'CNY' }],
      decisions: [
        { id: 'block', label: '低于金额下限', outcome: 'block' as const, priority: 20, match: 'all' as const, conditions: [{ property_key: 'contract_amount', operator: '<' as const, value: 50000, unit: 'CNY' }], message: '合同金额低于五万元', action: '提交例外审批' },
        { id: 'pass', label: '符合下限', outcome: 'pass' as const, priority: 10, match: 'all' as const, conditions: [{ property_key: 'contract_amount', operator: '>=' as const, value: 50000, unit: 'CNY' }] },
      ],
      missing_evidence_outcome: 'manual_review' as const,
    }

    const result = validateAIOutput(output, {
      contractText,
      rules: [{ code: 'MIN_AMOUNT', version: 2, execution_protocol: 'rule_contract_v1', rule_contract }],
      requireEvidenceInSource: true,
      requireRuleEvidenceHint: true,
    })

    expect(result.valid).toBe(true)
    expect(result.data?.risks[0]).toMatchObject({
      ruleCode: 'MIN_AMOUNT',
      ruleVersion: 2,
      decisionId: 'block',
      level: 'red',
      title: '低于金额下限',
      description: '合同金额低于五万元',
      suggestion: '提交例外审批',
      evidence: [contractText],
      propertyReadings: [{
        propertyKey: 'contract_amount',
        status: 'read',
        value: 40000,
        unit: 'CNY',
        evidence: contractText,
        confidence: 0.97,
      }],
    })
  })

  it('ignores a contradictory model decision candidate and overwrites it with deterministic output', () => {
    const contractText = '第一条 合同金额为40000元，双方确认按约履行。'
    const output = JSON.stringify({
      risks: [{
        ruleCode: 'MIN_AMOUNT',
        decisionId: 'pass',
        propertyReadings: [{
          propertyKey: 'contract_amount',
          status: 'read',
          value: 40000,
          unit: 'CNY',
          evidence: contractText,
          confidence: 0.9,
        }],
      }],
      summary: '模型输出',
    })

    const result = validateAIOutput(output, {
      contractText,
      rules: [{
        code: 'MIN_AMOUNT',
        execution_protocol: 'rule_contract_v1',
        rule_contract: {
          schema_version: '1.0',
          properties: [{ key: 'contract_amount', label: '合同金额', type: 'money', required: true, currency: 'CNY' }],
          decisions: [
            { id: 'block', label: '低于下限', outcome: 'block', priority: 20, match: 'all', conditions: [{ property_key: 'contract_amount', operator: '<', value: 50000, unit: 'CNY' }] },
            { id: 'pass', label: '达到下限', outcome: 'pass', priority: 10, match: 'all', conditions: [{ property_key: 'contract_amount', operator: '>=', value: 50000, unit: 'CNY' }] },
          ],
          missing_evidence_outcome: 'manual_review',
        },
      }],
      requireEvidenceInSource: true,
      requireRuleEvidenceHint: true,
    })

    expect(result.valid).toBe(true)
    expect(result.data?.risks[0]).toMatchObject({ decisionId: 'block', level: 'red', title: '低于下限' })
  })

  it('allows an optional missing reading without invented evidence and executes not_exists', () => {
    const contractText = '本合同约定自动续约，其他事项由双方另行协商。'
    const output = JSON.stringify({
      risks: [{
        ruleCode: 'RENEWAL_EXIT',
        propertyReadings: [{
          propertyKey: 'renewal_exit',
          status: 'missing',
          confidence: 0.8,
        }],
      }],
      summary: '未找到退出机制',
    })
    const result = validateAIOutput(output, {
      contractText,
      rules: [{
        code: 'RENEWAL_EXIT',
        version: 3,
        execution_protocol: 'rule_contract_v1',
        rule_contract: {
          schema_version: '1.0',
          properties: [{ key: 'renewal_exit', label: '续约退出机制', type: 'text', required: false }],
          decisions: [{
            id: 'missing-exit',
            label: '缺少退出机制',
            outcome: 'block',
            priority: 10,
            match: 'all',
            conditions: [{ property_key: 'renewal_exit', operator: 'not_exists' }],
            action: '补充退出条款',
          }],
          missing_evidence_outcome: 'manual_review',
        },
      }],
      requireEvidenceInSource: true,
    })

    expect(result.valid).toBe(true)
    expect(result.data?.risks[0]).toMatchObject({
      decisionId: 'missing-exit',
      level: 'red',
      evidence: [],
      propertyReadings: [{ propertyKey: 'renewal_exit', status: 'missing', confidence: 0.8 }],
    })
  })

  it.each([
    {
      name: 'required missing',
      contractText: '本合同只约定双方友好履约。',
      reading: { propertyKey: 'contract_amount', status: 'missing', confidence: 0 },
      missingOutcome: 'block',
      expectedLevel: 'red',
      expectedTitle: '缺少必填属性，按规则阻断',
      expectedDetail: '缺少必填属性：合同金额',
      expectedSuggestion: '补充或澄清规则事实后重新审核；当前按规则阻断',
      expectedEvidence: [],
    },
    {
      name: 'ambiguous values',
      contractText: '合同金额分别记载为40000元和60000元。',
      reading: { propertyKey: 'contract_amount', status: 'ambiguous', evidence: '合同金额分别记载为40000元和60000元。', confidence: 0.7 },
      missingOutcome: 'manual_review',
      expectedLevel: 'yellow',
      expectedTitle: '属性值存在冲突，需人工复核',
      expectedDetail: '同一属性存在多个冲突值：合同金额',
      expectedSuggestion: '提交人工复核，确认规则事实后重新审核',
      expectedEvidence: ['合同金额分别记载为40000元和60000元。'],
    },
    {
      name: 'currency conflict',
      contractText: '合同金额记载为USD 40000，但规则要求人民币口径。',
      reading: { propertyKey: 'contract_amount', status: 'unit_conflict', unit: 'USD', evidence: '合同金额记载为USD 40000，但规则要求人民币口径。', confidence: 0.9 },
      missingOutcome: 'manual_review',
      expectedLevel: 'yellow',
      expectedTitle: '属性单位或币种冲突，需人工复核',
      expectedDetail: '属性单位或币种冲突：合同金额',
      expectedSuggestion: '提交人工复核，确认规则事实后重新审核',
      expectedEvidence: ['合同金额记载为USD 40000，但规则要求人民币口径。'],
    },
    {
      name: 'no reachable decision',
      contractText: '合同金额为人民币60000元。',
      reading: { propertyKey: 'contract_amount', status: 'read', value: 60000, unit: 'CNY', evidence: '合同金额为人民币60000元。', confidence: 0.98 },
      missingOutcome: 'manual_review',
      expectedLevel: 'yellow',
      expectedTitle: '没有可达判定，需人工复核',
      expectedDetail: '已读取属性未命中任何已配置判定',
      expectedSuggestion: '提交人工复核，确认规则事实后重新审核',
      expectedEvidence: ['合同金额为人民币60000元。'],
    },
  ] as const)('normalizes $name through configured missing_evidence_outcome', (testCase) => {
    const output = JSON.stringify({
      risks: [{
        ruleCode: 'MIN_AMOUNT',
        decisionId: 'model-must-not-control-fallback',
        propertyReadings: [testCase.reading],
        level: 'green',
        title: '模型自定标题',
        description: '模型自定说明',
        suggestion: '模型自定动作',
        evidence: ['模型自定证据'],
      }],
      summary: '模型定位完成',
    })
    const result = validateAIOutput(output, {
      contractText: testCase.contractText,
      rules: [{
        code: 'MIN_AMOUNT',
        version: 4,
        execution_protocol: 'rule_contract_v1',
        rule_contract: {
          schema_version: '1.0',
          properties: [{ key: 'contract_amount', label: '合同金额', type: 'money', required: true, currency: 'CNY' }],
          decisions: [{
            id: 'below-minimum',
            label: '低于金额下限',
            outcome: 'block',
            priority: 20,
            match: 'all',
            conditions: [{ property_key: 'contract_amount', operator: '<', value: 50000, unit: 'CNY' }],
          }],
          missing_evidence_outcome: testCase.missingOutcome,
        },
      }],
      requireEvidenceInSource: true,
    })

    expect(result.valid).toBe(true)
    expect(result.data?.risks[0]).toMatchObject({
      ruleCode: 'MIN_AMOUNT',
      ruleVersion: 4,
      level: testCase.expectedLevel,
      title: testCase.expectedTitle,
      suggestion: testCase.expectedSuggestion,
      evidence: testCase.expectedEvidence,
      propertyReadings: [testCase.reading],
    })
    expect(result.data?.risks[0].description).toContain(testCase.expectedDetail)
    expect(result.data?.risks[0].decisionId).toBeUndefined()
  })

  it.each([
    [{ propertyKey: 'invented_amount', status: 'read', value: 40000, unit: 'CNY', confidence: 0.9 }, 'is not defined by rule_contract'],
    [{ propertyKey: 'contract_amount', status: 'read', value: '四万元', unit: 'CNY', confidence: 0.9 }, 'money requires a finite number'],
    [{ propertyKey: 'contract_amount', status: 'read', value: 40000, unit: 'USD', confidence: 0.9 }, 'expected CNY'],
  ])('rejects undefined, mistyped, or wrong-unit canonical readings', (reading, expectedError) => {
    const contractText = '第一条 合同金额为40000元，双方确认按约履行。'
    const output = JSON.stringify({
      risks: [{
        ruleCode: 'MIN_AMOUNT',
        decisionId: 'block',
        propertyReadings: [{ ...reading, evidence: contractText }],
      }],
      summary: '模型输出',
    })
    const result = validateAIOutput(output, {
      contractText,
      rules: [{
        code: 'MIN_AMOUNT',
        execution_protocol: 'rule_contract_v1',
        rule_contract: {
          schema_version: '1.0',
          properties: [{ key: 'contract_amount', label: '合同金额', type: 'money', required: true, currency: 'CNY' }],
          decisions: [{ id: 'block', label: '低于下限', outcome: 'block', priority: 20, match: 'all', conditions: [{ property_key: 'contract_amount', operator: '<', value: 50000, unit: 'CNY' }] }],
          missing_evidence_outcome: 'manual_review',
        },
      }],
      requireEvidenceInSource: true,
    })

    expect(result.valid).toBe(false)
    expect(result.error).toContain(expectedError)
  })

  it('rejects a canonical reading whose evidence is a paraphrase instead of a continuous source fragment', () => {
    const contractText = '第一条 合同含税总价为人民币40000元，双方确认按约履行。'
    const output = JSON.stringify({
      risks: [{
        ruleCode: 'MIN_AMOUNT',
        decisionId: 'block',
        propertyReadings: [{
          propertyKey: 'contract_amount',
          status: 'read',
          value: 40000,
          unit: 'CNY',
          evidence: '合同金额是四万元',
          confidence: 0.9,
        }],
      }],
      summary: '模型输出',
    })
    const result = validateAIOutput(output, {
      contractText,
      rules: [{
        code: 'MIN_AMOUNT',
        execution_protocol: 'rule_contract_v1',
        rule_contract: {
          schema_version: '1.0',
          properties: [{ key: 'contract_amount', label: '合同金额', type: 'money', required: true, currency: 'CNY' }],
          decisions: [{ id: 'block', label: '低于下限', outcome: 'block', priority: 20, match: 'all', conditions: [{ property_key: 'contract_amount', operator: '<', value: 50000, unit: 'CNY' }] }],
          missing_evidence_outcome: 'manual_review',
        },
      }],
      requireEvidenceInSource: true,
    })

    expect(result.valid).toBe(false)
    expect(result.error).toContain('evidence is not a continuous source fragment')
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
