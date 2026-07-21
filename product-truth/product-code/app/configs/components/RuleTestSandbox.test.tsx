import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'app/configs/components/RuleTestSandbox.tsx'), 'utf8')

describe('RuleTestSandbox quick condition check source contract', () => {
  it('states that the sandbox is deterministic and does not prove model execution', () => {
    expect(source).toContain('快速条件检查（不调用模型）')
    expect(source).toContain('不会调用 AI 模型，也不代表完整合同审核已经跑通')
    expect(source).toContain('请在合同审核中用真实文件验证模型读取、ReviewRun 和风险证据链')
    expect(source).not.toContain('测试真实合同段落')
  })

  it('runs every generated release case from one action and reports each result', () => {
    expect(source).toContain('async function runAllTests()')
    expect(source).toContain('for (const example of examples)')
    expect(source).toContain('const test = await requestTest(example)')
    expect(source).toContain('一键检查全部 ${examples.length} 个用例')
    expect(source).toContain('全部用例：{batchResults.filter((item) => item.passed).length}/{batchResults.length} 通过')
    expect(source).toContain("caseKind: decision.outcome === 'pass' ? 'pass' : 'risk'")
    expect(source).toContain('if (ruleContractRequiresMissingEvidenceCase(contract))')
  })

  it('keeps rule-level condition evidence separate from full business runtime evidence', () => {
    expect(source).toContain("fetch('/api/rules/test'")
    expect(source).toContain('本地规则读取结果')
    expect(source).toContain('这里不验证模型能否理解不同措辞')
    expect(source).toContain('本次条件断言已保存')
  })

  it('identifies the draft with business language instead of exposing its machine code', () => {
    expect(source).toContain('{rule.name} · 草稿 v{rule.version || 1}')
    expect(source).not.toContain('{rule.code} · {rule.name}')
  })
})
