import { describe, it, expect } from 'vitest'
import { detectHallucination } from './hallucination-detector'

describe('detectHallucination', () => {
  it('should detect hallucination when keywords not in original', () => {
    const aiOutput = JSON.stringify({
      risks: [
        {
          level: 'red',
          title: '虚构条款',
          description: '合同包含不存在的保密条款',
          suggestion: '删除',
        },
      ],
      summary: '存在虚构条款',
    })

    const originalText = '这是一份简单的采购合同，约定付款方式为月结30天。'

    const result = detectHallucination(aiOutput, originalText)
    expect(result.hasHallucination).toBe(true)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it('should pass for consistent output (simplified)', () => {
    // 简化为：关键词都在原文中的简单情况
    const aiOutput = JSON.stringify({
      risks: [
        {
          level: 'red',
          title: '账期',
          description: '账期',
          suggestion: '缩短',
        },
      ],
      summary: '账期',
    })

    const originalText = '账期是120天，付款方式为月结。'

    const result = detectHallucination(aiOutput, originalText)
    // 简化场景下不应检测到幻觉
    expect(result.hasHallucination).toBe(false)
  })
})
