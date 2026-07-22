// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { defaultOptions, renderAsync } from 'docx-preview'
import { describe, expect, it } from 'vitest'
import {
  createDocxPreviewElementFactory,
  enhanceRenderedWordComments,
  hardenRenderedWordDom,
  hardenRenderedWordStyles,
} from './browser-word-preview'

describe('real Word browser rendering', () => {
  it('keeps revisions and existing comments from the controlled DOCX', async () => {
    const source = readFileSync(resolve(process.cwd(), 'output/evidence/g5/controlled-revisions-comments-proof.docx'))
    const body = document.createElement('div')
    const styles = document.createElement('div')

    await renderAsync(source, body, styles, {
      className: 'word-proof',
      renderChanges: true,
      renderComments: true,
      renderAltChunks: false,
      useBase64URL: true,
      h: createDocxPreviewElementFactory(defaultOptions.h),
    })
    hardenRenderedWordDom(body)
    hardenRenderedWordStyles(styles)
    enhanceRenderedWordComments(body, 'word-proof')

    expect(body.querySelectorAll('ins')).toHaveLength(2)
    expect(body.querySelectorAll('del')).toHaveLength(2)
    expect(body.querySelectorAll('.word-proof-comment-ref')).toHaveLength(1)
    expect(body.querySelectorAll('.word-proof-comment-popover')).toHaveLength(1)
    expect(body.querySelector('.word-proof-comment-popover')?.textContent).toContain('请补充可执行的 SLA 赔付责任')
    expect(body.querySelector<HTMLElement>('.word-proof-comment-ref')?.tabIndex).toBe(0)
  })
})
