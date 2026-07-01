import { describe, expect, it } from 'vitest'
import {
  buildCommentPatchesFromRiskCards,
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

  it('extracts RiskFinding identity from persisted annotation comments', () => {
    expect(extractRiskFindingId('建议调整\nRiskFinding: 11111111-1111-4111-8111-111111111111'))
      .toBe('11111111-1111-4111-8111-111111111111')
    expect(extractRiskFindingId('普通批注')).toBeNull()
  })
})
