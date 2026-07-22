import { describe, expect, it } from 'vitest'
import { validateSourceAnnotation, type SourceAnnotation } from './annotations'

const base: Omit<SourceAnnotation, 'anchor'> = {
  id: 'annotation-1',
  source: {
    contractId: 'contract-1',
    storagePath: 'contract-1/source.pdf',
    sourceHash: 'a'.repeat(64),
    page: 2,
  },
  comment: '付款条件需要复核',
}

describe('source annotations', () => {
  it.each([
    { kind: 'text', start: 12, end: 20, exact: '付款条件' },
    { kind: 'region', region: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 } },
    { kind: 'point', point: { x: 0.8, y: 0.7 } },
  ] as SourceAnnotation['anchor'][] )('accepts $kind anchors', (anchor) => {
    expect(validateSourceAnnotation({ ...base, anchor })).toEqual([])
  })

  it('allows manual region annotation when OCR has no result', () => {
    expect(validateSourceAnnotation({
      ...base,
      anchor: { kind: 'region', region: { x: 0, y: 0, width: 1, height: 1 } },
    })).toEqual([])
  })

  it('rejects zero-length text anchors even when exact text is present', () => {
    expect(validateSourceAnnotation({
      ...base,
      anchor: { kind: 'text', start: 12, end: 12, exact: '付款条件' },
    })).toContain('text.end 必须大于 start')
  })

  it('rejects coordinates outside the page and invalid source identity', () => {
    const errors = validateSourceAnnotation({
      ...base,
      source: { ...base.source, sourceHash: 'not-a-hash', page: 0 },
      anchor: { kind: 'point', point: { x: 1.1, y: -0.1 }, ocrConfidence: 2 },
    })
    expect(errors).toContain('source.sourceHash 必须是 SHA-256')
    expect(errors).toContain('source.page 必须是正整数')
    expect(errors).toContain('point 必须位于归一化页面范围内')
    expect(errors).toContain('ocrConfidence 必须介于 0 和 1')
  })
})
