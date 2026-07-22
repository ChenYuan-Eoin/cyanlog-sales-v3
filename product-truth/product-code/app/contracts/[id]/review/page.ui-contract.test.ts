import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const pageSource = readFileSync(resolve(process.cwd(), 'app/contracts/[id]/review/page.tsx'), 'utf8')
const reviewRouteSource = readFileSync(resolve(process.cwd(), 'app/api/contracts/[id]/review/route.ts'), 'utf8')
const appShellSource = readFileSync(resolve(process.cwd(), 'components/layout/AppShell.tsx'), 'utf8')
const sidebarSource = readFileSync(resolve(process.cwd(), 'components/layout/Sidebar.tsx'), 'utf8')

describe('合同审核详情页 UI 合同', () => {
  it('保留三个风险级页签并提供可访问的键盘切换关系', () => {
    expect(pageSource).toContain("{ id: 'guide', label: '谈判指南' }")
    expect(pageSource).toContain("{ id: 'basis', label: '依据' }")
    expect(pageSource).toContain("{ id: 'evolution', label: '条款演变' }")
    expect(pageSource).toContain('aria-controls={`risk-panel-${tab}`}')
    expect(pageSource).toContain("event.key !== 'ArrowLeft' && event.key !== 'ArrowRight'")
    expect(pageSource).toContain('aria-labelledby="risk-panel-tab-guide"')
    expect(pageSource).toContain('aria-labelledby="risk-panel-tab-basis"')
    expect(pageSource).toContain('aria-labelledby="risk-panel-tab-evolution"')
  })

  it('风险选择与页签状态隔离，避免切换页签改变文档定位或未保存决策', () => {
    const selectRiskBlock = pageSource.slice(
      pageSource.indexOf('const selectRisk = useCallback'),
      pageSource.indexOf('const centerSourceHighlight = useCallback')
    )

    expect(selectRiskBlock).not.toContain('setRightPanelTab')
    expect(pageSource).toContain("const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('guide')")
    expect(pageSource).toContain("const [selectedRiskId, setSelectedRiskId] = useState<string | null>(null)")
    expect(pageSource).toContain('当前风险有未保存的决策，请先保存成功或恢复为已保存内容。')
  })

  it('三栏空间把合同预览设为主视觉，并为依据和演变缺口展示真实空状态', () => {
    expect(pageSource).toContain('lg:grid-cols-[minmax(148px,12fr)_minmax(0,58fr)_minmax(336px,30fr)]')
    expect(pageSource).toContain('当前审核响应没有独立的标准条款字段')
    expect(pageSource).toContain('没有图片/PDF附件关系，因此不展示伪造缩略图')
    expect(pageSource).toContain('规则包版本与 ReviewRun 时间不能冒充条款版本')
  })

  it('三栏均可独立滚动，谈判指南内处理动作先于谈判口径出现', () => {
    expect(pageSource).toContain('data-scroll-region="risk-list"')
    expect(pageSource).toContain('data-scroll-region="source-document"')
    expect(pageSource).toContain('data-scroll-region="risk-actions"')
    expect(pageSource.indexOf('data-testid="decision-kind-actions"')).toBeLessThan(pageSource.indexOf('data-testid="solution-card"'))
    expect(pageSource).toContain('selectedSourceText={selectedRisk?.source_anchor?.exact_text || selectedRisk?.source_anchor?.excerpt}')
  })

  it('把文档级覆盖结论与原文锚点、页码跳转和批注导出隔离', () => {
    expect(reviewRouteSource).toContain('shouldExposeRiskSourceAnchor(risk, evidence)')
    expect(reviewRouteSource).toContain('evidence_anchors: sourceAnchor ? [sourceAnchor] : []')
    expect(pageSource).toContain('source_anchor: SourceAnchor | null')
    expect(pageSource).toContain('文档级覆盖结论，未绑定原文；不会跳转到第 1 页，也不会进入原文批注导出。')
    expect(pageSource).toContain('data-testid="document-coverage-status"')
    expect(pageSource).toContain("!risk.source_anchor\n                      ? '文档级覆盖结论，未绑定原文'")
  })

  it('只在风险清单保留风险身份，不重复红绿灯和运行技术信息', () => {
    expect(pageSource).not.toContain('levelMeta')
    expect(pageSource).not.toContain('<Badge')
    expect(pageSource).not.toContain('运行证据（辅助审计）')
    expect(pageSource).not.toContain('审查 / 任务跟进 ·')
  })

  it('审核详情页默认收起主导航并保留手动展开入口', () => {
    expect(appShellSource).toContain("/^\\/contracts\\/[^/]+\\/review\\/?$/.test(pathname)")
    expect(appShellSource).toContain("ones-review-sidebar-collapsed")
    expect(appShellSource).toContain("sidebarCollapsed ? 'lg:ml-16' : 'lg:ml-64'")
    expect(sidebarSource).toContain("collapsed ? 'lg:w-16' : 'lg:w-64'")
    expect(sidebarSource).toContain("aria-label={collapsed ? '展开全局导航' : '收起全局导航'}")
  })
})
