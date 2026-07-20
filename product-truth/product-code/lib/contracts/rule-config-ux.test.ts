import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('rule configuration product boundary', () => {
  const designer = source('app/configs/components/RuleDesigner.tsx')
  const tab = source('app/configs/tabs/RuleTab.tsx')
  const configsClient = source('app/configs/ConfigsClient.tsx')

  it('keeps the visible hierarchy on business objects', () => {
    for (const expected of [
      '当前规则集',
      '问题分类',
      '具体规则',
      '规则详情',
      '添加属性',
      '判定与处理',
      '全部条件都满足',
      '任一条件满足',
      '缺少明确值时',
      '保存草稿',
    ]) {
      expect(`${tab}\n${designer}`).toContain(expected)
    }
  })

  it('does not expose legacy execution configuration in the rule page', () => {
    const rulePage = `${tab}\n${designer}`
    for (const forbidden of [
      'Provider',
      'Prompt',
      '执行引擎',
      'target_field',
      'field_hints',
      'semantic_prompt',
      '语义定位',
      '转译',
      'RuleUnit',
      '审核引擎编译',
      '属性提取',
      '属性中心',
    ]) {
      expect(rulePage).not.toContain(forbidden)
    }
  })

  it('sends only business fields and the canonical contract from the config client', () => {
    const saveStart = configsClient.indexOf('async function handleSaveRule')
    const saveEnd = configsClient.indexOf('async function handleDeleteRule')
    const saveSource = configsClient.slice(saveStart, saveEnd)

    for (const expected of ['problem_category_id', 'rule_set_id', 'rule_contract']) {
      expect(saveSource).toContain(expected)
    }
    for (const forbidden of ['engine_type:', 'target_field:', 'field_hints:', 'semantic_prompt:', 'level_a_operator:']) {
      expect(saveSource).not.toContain(forbidden)
    }
  })

  it('separates contract rules from the global AI platform navigation', () => {
    expect(configsClient).toContain("id: 'contract-rules'")
    expect(configsClient).toContain("id: 'ai-platform'")
    expect(configsClient).toContain("tabs: ['rules']")
    expect(configsClient).toContain("tabs: ['ai']")
  })
})
