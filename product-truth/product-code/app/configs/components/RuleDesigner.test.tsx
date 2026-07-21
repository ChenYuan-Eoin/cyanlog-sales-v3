import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(process.cwd(), 'app/configs/components/RuleDesigner.tsx'), 'utf8')

describe('RuleDesigner business workflow source contract', () => {
  it('presents the editor as four business tasks and hides machine fields under advanced settings', () => {
    for (const label of [
      '1. 定义要检查的问题',
      '2. 定义要读取的信息',
      '3. 设置判断与处理',
      '4. 验证发布准备',
    ]) expect(source).toContain(label)

    expect(source).toContain('高级设置（通常无需修改）')
    expect(source).toContain('内部标识')
    expect(source.indexOf('高级设置（通常无需修改）')).toBeLessThan(source.indexOf('id="rule-code"'))
    expect(source).not.toContain("messages.push('填写规则编码')")
    expect(source).toContain("code: draft.code?.trim() || createAutoRuleCode()")
  })

  it('requires risk, normal pass, and explicit missing or conflict handling', () => {
    expect(source).toContain('至少添加一条风险判定')
    expect(source).toContain('添加一条覆盖正常情况的“通过”判定')
    expect(source).toContain('缺少明确值或内容冲突时')
    expect(source).toContain('为风险判定补齐处理动作和用户说明')
  })

  it('persists the same top-to-bottom decision order that runtime executes', () => {
    expect(source).toContain('orderRuleDecisionsForExecution')
    expect(source).toContain('resequenceRuleDecisions')
    expect(source).toContain('priority: (decisions.length - index) * 10')
    expect(source).toContain('decisions: resequenceRuleDecisions([')
    expect(source).not.toContain('lowestPriority')
    expect(source).not.toContain('id={`decision-priority-${decisionIndex}`}')
  })

  it('keeps save actionable and routes invalid submissions to the first field', () => {
    expect(source).toContain('const target = firstValidationTarget(draft, contract)')
    expect(source).toContain('setActiveTab(target.tab)')
    expect(source).toContain("document.getElementById(target.id)?.focus()")
    expect(source).toContain('<Button type="button" disabled={saving} onClick={submit}>')
    expect(source).not.toContain('disabled={saving || validation.length > 0}')
  })
})
