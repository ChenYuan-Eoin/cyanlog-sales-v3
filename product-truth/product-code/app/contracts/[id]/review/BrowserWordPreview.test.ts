import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const previewSource = readFileSync(resolve(process.cwd(), 'app/contracts/[id]/review/BrowserWordPreview.tsx'), 'utf8')
const comparisonSource = readFileSync(resolve(process.cwd(), 'components/contracts/comparison-source-preview.tsx'), 'utf8')

describe('BrowserWordPreview comparison integration contract', () => {
  it('keeps document loading bound to frozen scalar identity, not selected diff or object reference', () => {
    const loadEffectStart = previewSource.indexOf('useEffect(() => {')
    const selectionEffectStart = previewSource.indexOf('useEffect(() => {', loadEffectStart + 1)
    const loadEffect = previewSource.slice(loadEffectStart, selectionEffectStart)

    expect(loadEffect).toContain('storage_path: storagePath')
    expect(loadEffect).toContain('source_hash: sourceHash')
    expect(loadEffect).toContain('source_text_hash: sourceTextHash')
    expect(loadEffect).not.toContain('sourceIdentity.storage_path')
    expect(loadEffect).not.toContain('selectedRiskId')
    expect(loadEffect).not.toContain('selectedSourceText')
    expect(loadEffect).not.toMatch(/\}, \[[^\]]*sourceIdentity(?:,|\])/)

    expect(comparisonSource).toContain('const wordSourceIdentity = useMemo(() => ({')
    expect(comparisonSource).toContain('sourceIdentity={wordSourceIdentity}')
  })

  it('verifies the downloaded Blob before importing or rendering OOXML', () => {
    const blobRead = previewSource.indexOf('const sourceBlob = sourceResponse.ok ? await sourceResponse.blob() : null')
    const verification = previewSource.indexOf('await verifyBrowserWordSourceBlob(sourceBlob, sourceHash, expectedFileSize)')
    const rendererImport = previewSource.indexOf("() => import('docx-preview')")

    expect(blobRead).toBeGreaterThan(0)
    expect(verification).toBeGreaterThan(blobRead)
    expect(rendererImport).toBeGreaterThan(verification)
    expect(comparisonSource).toContain('expectedFileSize={source.file_size}')
  })

  it('passes frozen UTF-16 positions and normalized progress to the separate focus effect', () => {
    expect(comparisonSource).toContain('start_offset_utf16: selectedPosition.start_offset_utf16 ?? selectedPosition.start')
    expect(comparisonSource).toContain('end_offset_utf16: selectedPosition.end_offset_utf16 ?? selectedPosition.end')
    expect(comparisonSource).toContain('normalized_progress: selectedPosition.normalized_progress ?? selectedPosition.progress')
    expect(comparisonSource).toContain('selectedSourcePosition={wordSourcePosition}')
    expect(previewSource).toContain('focusRenderedWordSourceText(previewBody, selectedSourceText, {')
    expect(previewSource).toContain("data-testid=\"word-focus-notice\"")
  })
})
