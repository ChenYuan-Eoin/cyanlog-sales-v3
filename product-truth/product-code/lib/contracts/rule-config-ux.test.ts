import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('rule configuration product boundary', () => {
  const designer = source('app/configs/components/RuleDesigner.tsx')
  const sandbox = source('app/configs/components/RuleTestSandbox.tsx')
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
      '发布规则集',
    ]) {
      expect(`${tab}\n${designer}`).toContain(expected)
    }
  })

  it('keeps each decision, outcome and handling instruction in one business card', () => {
    const decisionsStart = designer.indexOf('<TabsContent value="decisions"')
    const validationStart = designer.indexOf('<TabsContent value="validation"')
    const decisionWorkspace = designer.slice(decisionsStart, validationStart)

    expect(decisionWorkspace).toContain('风险处理动作')
    expect(decisionWorkspace).toContain('给业务人员的风险说明')
    expect(decisionWorkspace).toContain('decision-action-')
    expect(decisionWorkspace).toContain('decision-message-')
    expect(designer).not.toContain('<TabsContent value="output"')
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
    expect(saveSource).toContain("...(!isUpdate ? { code: rule.code } : {})")
    expect(saveSource).not.toContain('\n        code: rule.code,')
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

  it('binds the editing workspace to one concrete rule set', () => {
    expect(tab).toContain("const [selectedRuleSetId, setSelectedRuleSetId] = useState('')")
    expect(tab).toContain('ruleSet.is_default')
    expect(tab).toContain("rules.filter((rule) => rule.rule_set_id === selectedRuleSetId)")
    expect(tab).not.toContain('<option value="all">全部规则集</option>')
    expect(tab).not.toContain('跨规则集查看')
  })

  it('fixes the current F009 consumer instead of asking users for vague scenario words', () => {
    expect(designer).toContain('合同审核（当前产品固定）')
    expect(designer).toContain("applicable_scenarios: ['contract_review']")
    expect(tab).toContain("applicable_scenario: 'contract_review'")
    expect(tab).not.toContain('请输入适用场景')
  })

  it('exposes a release test for every decision and supplies other required properties', () => {
    expect(sandbox).toContain('const examples: AcceptanceExample[] = decisions.map')
    expect(sandbox).toContain('property.required && !conditionKeys.has(property.key)')
    expect(sandbox).toContain("property.type !== 'enum' || (property.options?.length || 0) > 1")
    expect(sandbox).toContain("：${scalar === false ? '否' : '是'}")
    expect(sandbox).toContain('每条判定都要分别验收')
    expect(sandbox).not.toContain("decisions.find((decision)")
  })

  it('keeps selection compact while giving rule details a full-width workspace', () => {
    expect(tab).toContain('grid items-start gap-4 lg:grid-cols-[minmax(200px,0.8fr)_minmax(280px,1.2fr)]')
    expect(tab).toContain('min-w-0 scroll-mt-6 self-start overflow-hidden lg:col-span-2')
    expect(tab).not.toContain('xl:grid-cols-[210px_280px_minmax(0,1fr)]')
    expect((tab.match(/max-h-\[420px\]/g) || []).length).toBe(2)
    expect((tab.match(/overflow-x-hidden overflow-y-auto/g) || []).length).toBe(2)
    expect(tab).toContain('ref={categoryListRef}')
    expect(tab).toContain('ref={active ? selectedCategoryButtonRef : undefined}')
    expect(tab).toContain('buttonBounds.bottom > listBounds.bottom - padding')
    expect(tab).toContain("scrollIntoView({ behavior: 'smooth', block: 'start' })")
    expect((tab.match(/self-start overflow-hidden/g) || []).length).toBeGreaterThanOrEqual(3)
  })

  it('keeps the selected business context mounted during saves and test runs', () => {
    const refreshStart = configsClient.indexOf('const refreshTabData')
    const refreshEnd = configsClient.indexOf('useEffect(() => {', refreshStart)
    const refreshSource = configsClient.slice(refreshStart, refreshEnd)
    const saveStart = tab.indexOf('async function handleSaveRule')
    const saveEnd = tab.indexOf('async function handleCreateCategory')
    const saveSource = tab.slice(saveStart, saveEnd)
    const testStart = tab.indexOf('<RuleTestSandbox')
    const testEnd = tab.indexOf('</CardContent>', testStart)
    const testSource = tab.slice(testStart, testEnd)

    expect(refreshSource).toContain('await loadTabData(tab, { force: true })')
    expect(refreshSource).not.toContain('setLoadedTabs(')
    expect(saveSource).toContain('setSelectedRule(savedRule)')
    expect(saveSource).not.toContain('onRefresh?.()')
    expect(saveSource).toContain('error instanceof Error ? error.message')
    expect(testSource).toContain('await loadHierarchy()')
    expect(testSource).not.toContain('onRefresh?.()')
    expect(tab).toContain("ruleMode === 'new'\n      ? 'new'")
  })

  it('protects multi-step rule edits from silent navigation loss', () => {
    expect(designer).toContain('onDirtyChange?: (dirty: boolean) => void')
    expect(designer).toContain("window.addEventListener('beforeunload', preventAccidentalClose)")
    expect(designer).toContain('当前有未保存修改')
    expect(tab).toContain('confirmLeaveDirtyRule()')
    expect(tab).toContain('当前规则有未保存修改。离开会丢失这些修改，是否继续？')
    expect(tab).toContain('当前规则还有未保存修改。请先保存，再用已保存版本进行测试。')
    expect(tab).toContain('onDirtyChange={setDetailDirty}')
  })
})
