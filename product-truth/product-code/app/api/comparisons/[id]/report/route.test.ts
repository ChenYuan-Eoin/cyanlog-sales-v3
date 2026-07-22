import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const routeSource = readFileSync(
  resolve(process.cwd(), 'app/api/comparisons/[id]/report/route.ts'),
  'utf8',
)

function sourceIndex(fragment: string) {
  const index = routeSource.indexOf(fragment)
  expect(index, `missing route contract fragment: ${fragment}`).toBeGreaterThanOrEqual(0)
  return index
}

describe('G6 comparison report route contract', () => {
  it('loads the comparison and both frozen sources inside the authenticated organization', () => {
    expect(routeSource).toContain(".select('id,org_id,status,completed_at')")
    expect(routeSource).toContain(".eq('id', id)\n        .eq('org_id', orgId)")
    expect(routeSource).toContain("loadFrozenComparisonSource(id, 'old', orgId)")
    expect(routeSource).toContain("loadFrozenComparisonSource(id, 'new', orgId)")
    expect(routeSource).toContain("createApiError('NOT_FOUND', '比对记录不存在或无权访问')")
  })

  it('requires a completed comparison and both frozen sources before reading diffs or generating a report', () => {
    const completedGate = sourceIndex("if (comparison.status !== 'completed')")
    const completedAtGate = sourceIndex('if (!comparison.completed_at || !Number.isFinite(Date.parse(comparison.completed_at)))')
    const sourcePairGate = sourceIndex('if (!oldSource || !newSource)')
    const diffRead = sourceIndex(".from('comparison_diffs')")
    const generation = sourceIndex('const report = await generateComparisonReportDocx({')

    expect(completedGate).toBeLessThan(sourcePairGate)
    expect(completedGate).toBeLessThan(completedAtGate)
    expect(completedAtGate).toBeLessThan(sourcePairGate)
    expect(sourcePairGate).toBeLessThan(diffRead)
    expect(diffRead).toBeLessThan(generation)
    expect(routeSource.slice(completedGate, diffRead).match(/createApiError\('CONFLICT'/g)).toHaveLength(3)
  })

  it('requires bilateral original-text positions and carries both immutable source identities into DOCX generation', () => {
    const positionGate = sourceIndex('if (!oldPosition || !newPosition)')
    const generation = sourceIndex('const report = await generateComparisonReportDocx({')
    const response = sourceIndex('return new NextResponse(Uint8Array.from(report.buffer)')

    expect(positionGate).toBeLessThan(generation)
    expect(routeSource.slice(positionGate, generation)).toContain('不能生成假报告')
    expect(routeSource).toContain('old_source_text: stored.baseline_text')
    expect(routeSource).toContain('new_source_text: stored.compare_text')
    expect(routeSource).toContain('old_position: oldPosition')
    expect(routeSource).toContain('new_position: newPosition')
    expect(routeSource).toContain('completed_at: comparison.completed_at')
    expect(routeSource).toContain("locator: position.locator")

    const generationCall = routeSource.slice(generation, response)
    expect(generationCall.match(/file_sha256:/g)).toHaveLength(2)
    expect(generationCall.match(/text_sha256:/g)).toHaveLength(2)
    expect(generationCall.match(/immutable_at_creation: true/g)).toHaveLength(2)
  })

  it('forces fresh Storage byte verification before generating a report', () => {
    expect(routeSource.match(/downloadFrozenComparisonSource\([^,]+, \{ forceStorageVerification: true \}\)/g)).toHaveLength(2)
  })

  it('has no fake-success path when report evidence or generation fails', () => {
    const generation = sourceIndex('const report = await generateComparisonReportDocx({')
    const response = sourceIndex('return new NextResponse(Uint8Array.from(report.buffer)')
    const validationCatch = sourceIndex('if (error instanceof ComparisonReportValidationError)')
    const internalFailure = sourceIndex("createApiError('INTERNAL_ERROR', '差异报告生成失败')")

    expect(generation).toBeLessThan(response)
    expect(response).toBeLessThan(validationCatch)
    expect(validationCatch).toBeLessThan(internalFailure)
    expect(routeSource.match(/return new NextResponse\(/g)).toHaveLength(1)
    expect(routeSource.slice(validationCatch, internalFailure)).toContain("createApiError('CONFLICT'")
    expect(routeSource.slice(validationCatch, internalFailure)).toContain(', 409)')
  })
})
