import { describe, expect, it } from 'vitest'
import { buildDocumentDiff } from './document-diff'

describe('deterministic document diff', () => {
  it('returns added, deleted and modified hunks with two-sided positions', () => {
    const hunks = buildDocumentDiff(
      '保留\n删除条款\n旧付款条款\n结尾',
      '保留\n新付款条款\n结尾\n新增附件'
    )

    expect(hunks.map((hunk) => hunk.diff_type)).toEqual(['modified', 'added'])
    expect(hunks[0].baseline_text).toBe('删除条款\n旧付款条款')
    expect(hunks[0].compare_text).toBe('新付款条款')
    expect(hunks[0].baseline_position).toMatchObject({ start_line: 2, end_line: 3 })
    expect(hunks[0].compare_position).toMatchObject({ start_line: 2, end_line: 2 })
    expect(hunks[1].baseline_position.start_offset_utf16).toBe(hunks[1].baseline_position.end_offset_utf16)
  })

  it('keeps repeated lines deterministic instead of pairing unmatched arrays by index', () => {
    const baseline = '开始\n重复条款\n旧责任\n重复条款\n结束'
    const compare = '开始\n重复条款\n新责任\n重复条款\n结束'

    expect(buildDocumentDiff(baseline, compare)).toEqual(buildDocumentDiff(baseline, compare))
    const hunks = buildDocumentDiff(baseline, compare)
    expect(hunks).toHaveLength(1)
    expect(hunks[0]).toMatchObject({
      diff_type: 'modified',
      baseline_text: '旧责任',
      compare_text: '新责任',
      baseline_position: { start_line: 3, end_line: 3 },
      compare_position: { start_line: 3, end_line: 3 },
    })
  })

  it('represents a moved block as deletion and addition at the real locations', () => {
    const hunks = buildDocumentDiff('开始\n移动条款\n中间\n结束', '开始\n中间\n结束\n移动条款')

    expect(hunks.map((hunk) => hunk.diff_type)).toEqual(['deleted', 'added'])
    expect(hunks[0].baseline_text).toBe('移动条款')
    expect(hunks[1].compare_text).toBe('移动条款')
    expect(hunks[0].baseline_position.start_line).toBe(2)
    expect(hunks[1].compare_position.start_line).toBe(4)
  })

  it('ignores whitespace and newline encoding changes', () => {
    expect(buildDocumentDiff('第一条  付款\r\n\r\n第二条\u00a0责任', '第一条 付款\n第二条 责任')).toEqual([])
  })

  it('groups cross-line replacement into one hunk', () => {
    const [hunk] = buildDocumentDiff(
      '开始\n旧条款一\n旧条款二\n结束',
      '开始\n新条款一\n新条款二\n新条款三\n结束'
    )

    expect(hunk.diff_type).toBe('modified')
    expect(hunk.baseline_position).toMatchObject({ start_line: 2, end_line: 3 })
    expect(hunk.compare_position).toMatchObject({ start_line: 2, end_line: 4 })
  })

  it('reports JavaScript UTF-16 offsets, including surrogate pairs', () => {
    const [hunk] = buildDocumentDiff('😀旧', '😀新')

    expect(hunk.baseline_position).toMatchObject({ start_offset_utf16: 0, end_offset_utf16: 3 })
    expect(hunk.compare_position).toMatchObject({ start_offset_utf16: 0, end_offset_utf16: 3 })
    expect(hunk.baseline_text).toBe('😀旧')
  })

  it('uses a collapsed opposite-side position for a wholly added document', () => {
    const [hunk] = buildDocumentDiff('', '新增合同')

    expect(hunk.diff_type).toBe('added')
    expect(hunk.baseline_position).toEqual({
      start_offset_utf16: 0,
      end_offset_utf16: 0,
      start_line: 1,
      end_line: 1,
      normalized_progress: 0,
    })
  })
})
