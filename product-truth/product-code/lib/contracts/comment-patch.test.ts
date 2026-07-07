import { describe, expect, it } from 'vitest'
import {
  appendRiskControlCommentLines,
  buildCommentPatchesFromRiskCards,
  buildCustomerFacingWordComment,
  extractRiskFindingId,
} from './comment-patch'

describe('comment patch adapter', () => {
  it('builds open red and yellow risk findings into Word comment annotation drafts', () => {
    const patches = buildCommentPatchesFromRiskCards({
      contractId: 'contract-1',
      risks: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          level: 'red',
          title: '付款周期过长',
          description: '付款周期超过 90 天',
          suggestion: '要求改为 30 天内付款',
          evidence: { snippets: ['付款周期为 120 天'] },
          status: 'open',
          position_start: 20,
          position_end: 31,
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          level: 'yellow',
          title: '质保期限偏长',
          status: 'open',
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          level: 'green',
          title: '标准保密条款',
          status: 'open',
        },
      ],
    })

    expect(patches).toHaveLength(2)
    expect(patches[0]).toMatchObject({
      risk_id: '11111111-1111-4111-8111-111111111111',
      annotation: {
        contract_id: 'contract-1',
        start_offset: 20,
        end_offset: 31,
        selected_text: '付款周期为 120 天',
        category: 'risk_finding',
        priority: 'urgent',
        status: 'open',
      },
    })
    expect(patches[0].annotation.comment).toContain('红线风险')
    expect(patches[0].annotation.comment).toContain('RiskFinding: 11111111-1111-4111-8111-111111111111')
    expect(patches[1].annotation.priority).toBe('high')
    expect(patches[1].annotation.selected_text).toBe('')
    expect(patches[1].annotation.comment).toContain('【需人工定位】')
    expect(patches[1].annotation.comment).toContain('LocationStatus: manual_required')
  })

  it('does not duplicate existing comment patches or closed risk findings', () => {
    const existingRiskIds = new Set(['11111111-1111-4111-8111-111111111111'])
    const patches = buildCommentPatchesFromRiskCards({
      contractId: 'contract-1',
      existingRiskIds,
      risks: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          level: 'red',
          title: '已存在批注',
          status: 'open',
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          level: 'red',
          title: '已接受风险',
          status: 'accepted',
        },
      ],
    })

    expect(patches).toHaveLength(0)
  })

  it('keeps a located comment only when the source range exactly matches evidence text', () => {
    const patches = buildCommentPatchesFromRiskCards({
      contractId: 'contract-1',
      sourceText: '第一条 付款周期为 120 天，甲方应按约付款。',
      risks: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          level: 'red',
          title: '付款周期过长',
          evidence: {
            snippets: ['付款周期为 120 天'],
            source_range: { start: 4, end: 15 },
          },
          status: 'open',
        },
      ],
    })

    expect(patches).toHaveLength(1)
    expect(patches[0].annotation.selected_text).toBe('付款周期为 120 天')
    expect(patches[0].annotation.start_offset).toBe(4)
    expect(patches[0].annotation.end_offset).toBe(15)
    expect(patches[0].annotation.comment).toContain('SourceRange: 4-15')
  })

  it('marks stale source ranges as manual instead of producing a false Word anchor', () => {
    const patches = buildCommentPatchesFromRiskCards({
      contractId: 'contract-1',
      sourceText: '第一条 付款周期为 30 天，甲方应按约付款。',
      risks: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          level: 'red',
          title: '付款周期过长',
          evidence: {
            snippets: ['付款周期为 120 天'],
            source_range: { start: 4, end: 15 },
          },
          status: 'open',
        },
      ],
    })

    expect(patches).toHaveLength(1)
    expect(patches[0].annotation.selected_text).toBe('')
    expect(patches[0].annotation.start_offset).toBe(0)
    expect(patches[0].annotation.end_offset).toBe(0)
    expect(patches[0].annotation.comment).toContain('【需人工定位】')
    expect(patches[0].annotation.comment).toContain('source range text mismatch')
    expect(patches[0].annotation.comment).toContain('LocationStatus: manual_required')
  })

  it('extracts RiskFinding identity from persisted annotation comments', () => {
    expect(extractRiskFindingId('建议调整\nRiskFinding: 11111111-1111-4111-8111-111111111111'))
      .toBe('11111111-1111-4111-8111-111111111111')
    expect(extractRiskFindingId('普通批注')).toBeNull()
  })

  it('sanitizes internal annotation metadata before writing customer-facing Word comments', () => {
    const comment = [
      '【红线风险】IP 归属',
      '问题：客户主张 ONES 产品 IP / 交付源代码',
      '建议：必须修改合同条款',
      '证据原文：2.1 主合同项下的产品标准',
      '规则：R011 v3',
      'RuleSnapshot: snapshot-1',
      'SourceRange: 866-933',
      'RiskFinding: 4edab676-7434-418e-b87a-7bacbbce882c',
    ].join('\n')

    const customerComment = buildCustomerFacingWordComment(comment)

    expect(customerComment).toContain('【必须修改】IP 归属')
    expect(customerComment).toContain('建议修改为：必须修改合同条款')
    expect(customerComment).not.toContain('RiskFinding')
    expect(customerComment).not.toContain('SourceRange')
    expect(customerComment).not.toContain('RuleSnapshot')
    expect(customerComment).not.toContain('证据原文')
    expect(customerComment).not.toContain('规则：')
  })

  it('keeps already customer-facing Word comments stable', () => {
    const comment = [
      '【必须修改】付款周期过长',
      '建议修改为：要求改为 30 天内付款',
      '处理要求：请按上述口径修订后回传确认。',
    ].join('\n')

    expect(buildCustomerFacingWordComment(comment)).toBe(comment)
  })

  it('writes manual control notes into Word comment text without closing the risk', () => {
    const patches = buildCommentPatchesFromRiskCards({
      contractId: 'contract-1',
      sourceText: '第一条 回款批次和付款比例待双方确认。',
      risks: [
        {
          id: '66666666-6666-4666-8666-666666666666',
          level: 'yellow',
          title: '回款批次不明确',
          description: '合同未明确分批回款比例',
          suggestion: '要求客户确认回款批次',
          evidence: {
            snippets: ['回款批次和付款比例待双方确认'],
            source_range: { start: 4, end: 18 },
          },
          fix_action: {
            control_note: '回款按 3/3/4 分三期，首期验收后 15 个工作日内支付。',
          },
          status: 'open',
        },
      ],
    })

    expect(patches).toHaveLength(1)
    expect(patches[0].annotation.comment).toContain('可控化说明：回款按 3/3/4 分三期')
    expect(patches[0].annotation.comment).toContain('确认前风险仍保持开放')
  })

  it('appends control notes to existing comments only once', () => {
    const comment = '【需谈判风险】回款批次不明确\nRiskFinding: 77777777-7777-4777-8777-777777777777'
    const risk = {
      id: '77777777-7777-4777-8777-777777777777',
      level: 'yellow' as const,
      title: '回款批次不明确',
      fix_action: {
        control_note: '请客户确认三期回款比例。',
      },
    }

    const once = appendRiskControlCommentLines(comment, risk)
    const twice = appendRiskControlCommentLines(once, risk)

    expect(once).toContain('可控化说明：请客户确认三期回款比例。')
    expect(twice.match(/可控化说明/g)).toHaveLength(1)
  })
})
