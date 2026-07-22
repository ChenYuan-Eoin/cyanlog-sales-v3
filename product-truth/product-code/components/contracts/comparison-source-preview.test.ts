import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const previewSource = readFileSync(
  resolve(process.cwd(), 'components/contracts/comparison-source-preview.tsx'),
  'utf8',
)

describe('G6 frozen PDF preview layout contract', () => {
  it('uses each rendered PNG natural ratio instead of assuming portrait A4', () => {
    expect(previewSource).not.toContain("aspectRatio: '1 / 1.414'")
    expect(previewSource).toContain('const { naturalWidth, naturalHeight } = event.currentTarget')
    expect(previewSource).toContain('setPageAspectRatio(`${naturalWidth} / ${naturalHeight}`)')
    expect(previewSource).toContain('aspectRatio: pageAspectRatio')
  })

  it('keeps rendered line-box percentages in the same relative image container', () => {
    const relativeContainer = previewSource.indexOf("className={cn('relative mx-auto overflow-hidden border bg-white shadow-lg'")
    const image = previewSource.indexOf('className="block h-auto w-full max-w-none"', relativeContainer)
    const lineBoxes = previewSource.indexOf("left: `${box.left}%`", image)

    expect(relativeContainer).toBeGreaterThanOrEqual(0)
    expect(image).toBeGreaterThan(relativeContainer)
    expect(lineBoxes).toBeGreaterThan(image)
    expect(previewSource).toContain("top: `${box.top}%`")
    expect(previewSource).toContain("width: `${box.width}%`")
    expect(previewSource).toContain("height: `${box.height}%`")
  })
})
