import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const tabSource = readFileSync(resolve(process.cwd(), 'app/configs/tabs/RuleTab.tsx'), 'utf8')
const designerSource = readFileSync(resolve(process.cwd(), 'app/configs/components/RuleDesigner.tsx'), 'utf8')
const clientSource = readFileSync(resolve(process.cwd(), 'app/configs/ConfigsClient.tsx'), 'utf8')
const adminSource = readFileSync(resolve(process.cwd(), 'app/admin/contract-policies/page.tsx'), 'utf8')
const simulatorSource = readFileSync(resolve(process.cwd(), 'app/admin/rule-simulator/page.tsx'), 'utf8')
const versionSource = readFileSync(resolve(process.cwd(), 'app/admin/contract-policies/rules/[id]/versions/page.tsx'), 'utf8')

describe('rule collection product source contract', () => {
  it('orders the human workflow from release boundary to problem, rule, property and decision', () => {
    const labels = [
      '当前规则集',
      '问题分类',
      '具体规则',
      '规则详情',
    ]
    expect(labels.every((label) => tabSource.includes(label))).toBe(true)
    expect(tabSource).toContain('规则集是一套可统一发布的审核规则；在规则集内按问题分类维护具体规则、属性、判定和处理。')
    expect(designerSource).toContain('这条规则包含哪些业务属性')
    expect(designerSource).toContain('属性满足什么条件时，系统应如何处理')
    expect(designerSource).toContain('缺少明确值时')
    expect(tabSource).toContain('结构完整 · 待发布验收')
    expect(tabSource).toContain('配置完整 · 已通过发布验收')
    expect(tabSource).not.toContain('规则详情已确认')
  })

  it('keeps category selection single-write and states online plus pending RuleSet truth together', () => {
    const categoryHandler = tabSource.slice(
      tabSource.indexOf('function handleSelectCategory'),
      tabSource.indexOf('function handleNewRule')
    )
    expect(categoryHandler.match(/setSelectedCategoryId\(category\.id\)/g)).toHaveLength(1)
    expect(tabSource).toContain('selectedRuleSet.current_snapshot_id')
    expect(tabSource).toContain('线上发布版本仍在生效 · 草稿 v${selectedRuleSet.version} 待发布')
    expect(tabSource).toContain('草稿 v${selectedRuleSet.version} 待首次发布')
  })

  it('keeps navigation separate from the business model and removes machine configuration', () => {
    const combined = `${tabSource}\n${designerSource}`

    expect(combined).not.toContain('规则库树')
    expect(combined).not.toContain('机器执行骨架')
    expect(combined).not.toContain('定位关键词')
    expect(combined).not.toContain('判定器类型')
    expect(combined).not.toContain('执行引擎')
    expect(combined).not.toContain('semantic_prompt')
    expect(combined).not.toContain('Prompt')
    expect(combined).not.toContain('转译')
  })

  it('publishes only the complete RuleSet and keeps test evidence tied to the saved draft', () => {
    expect(tabSource).toContain('/publish')
    expect(tabSource).toContain('规则集“${selectedRuleSet.name}”已发布')
    expect(tabSource).toContain('当前规则还有未保存修改')
    expect(tabSource).toContain('快速检查当前规则的条件与结果（不调用 AI 模型）')
    expect(tabSource).not.toContain('/versions/${versionId}/publish')
  })

  it('keeps machine identifiers out of the business creation flow and exposes every release blocker', () => {
    expect(tabSource).not.toContain('label="规则集编码"')
    expect(tabSource).not.toContain('label="分类编码"')
    expect(tabSource).toContain('内部标识由系统自动生成')
    expect(tabSource).toContain('selectedRuleSet.publish_blockers.map')
    expect(tabSource).toContain('从空白规则集开始')
    expect(tabSource).toContain('规则版本 v{rule.version || 1}')
    expect(tabSource).not.toContain('{rule.code} · v{rule.version || 1}')
  })

  it('allows historical replay without claiming an unconfirmed migration draft can run', () => {
    expect(designerSource).toContain('历史审核只能按当时冻结的旧快照回放')
    expect(designerSource).toContain('当前迁移草稿不能用于新的正式审核')
    expect(designerSource).not.toContain('系统仍可按旧协议兼容运行')
  })

  it('does not lose the selected rule when a stop action is cancelled', () => {
    expect(tabSource).toContain('const stopped = await onDelete(selectedRule.id)')
    expect(tabSource).toContain('if (!stopped) return')
    expect(tabSource).not.toContain('setSelectedRule(null)\n                      }}>')
    expect(clientSource).toContain("confirmText: '标记待停用'")
    expect(clientSource).toContain('当前线上版本继续生效')
    expect(clientSource).toContain('return true')
    expect(clientSource).toContain('return false')
  })

  it('redirects obsolete A/B/C administration screens to the one control plane', () => {
    expect(adminSource).toContain("redirect('/configs?tab=rules')")
    expect(simulatorSource).toContain("redirect('/configs?tab=rules')")
    expect(versionSource).toContain('redirect(`/configs?tab=rules&ruleId=')
    expect(adminSource).not.toContain('level_a_threshold')
    expect(simulatorSource).not.toContain('levelColors')
    expect(simulatorSource).not.toContain('SimulationResult')
    expect(versionSource).not.toContain('JSON.stringify')
  })
})
