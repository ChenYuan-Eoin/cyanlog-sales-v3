import { describe, expect, it } from 'vitest'
import {
  comparisonTaskState,
  contractVersionLabel,
  draftVersionLabel,
  reviewTaskState,
  versionSourceLabel,
} from './task-model'

describe('contract center task model', () => {
  it('uses the persisted latest contract version instead of list position', () => {
    expect(contractVersionLabel({ latest_version: { version_number: 7 } })).toBe('v7')
    expect(contractVersionLabel({ contract_versions: [{ version_number: 12 }] })).toBe('v12')
    expect(contractVersionLabel({ contract_versions: [] })).toBe('版本待确认')
  })

  it('only labels a draft version when a persisted version exists', () => {
    expect(draftVersionLabel(3)).toBe('v3 · 草稿')
    expect(draftVersionLabel()).toBe('版本待确认')
  })

  it('keeps module state and next action distinct', () => {
    expect(reviewTaskState('COMPLETED')).toMatchObject({
      label: '审核完成',
      nextAction: '查看批注 / 再审核',
    })
    expect(comparisonTaskState('failed')).toMatchObject({
      label: '比对失败',
      nextAction: '替换文件 / 重新对比',
    })
  })

  it('renders the persisted version source', () => {
    expect(versionSourceLabel('review_revision')).toBe('批注/修订版')
    expect(versionSourceLabel(null)).toBe('版本来源待确认')
  })
})
