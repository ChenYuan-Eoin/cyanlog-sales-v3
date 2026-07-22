import { createHash } from 'crypto'
import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  COMPARISON_REPORT_MIME_TYPE,
  ComparisonReportValidationError,
  buildComparisonReportFilename,
  generateComparisonReportDocx,
  type ComparisonReportInput,
} from './comparison-report'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const SHA_C = 'c'.repeat(64)
const SHA_D = 'd'.repeat(64)

type MutableRecord = Record<string, unknown>

function mutableRecord(value: unknown) {
  return value as MutableRecord
}

function firstDiff(input: MutableRecord) {
  return mutableRecord((input.diffs as unknown[])[0])
}

function validInput(): ComparisonReportInput {
  return {
    comparison_id: 'cmp-20260718-001',
    completed_at: '2026-07-18T02:05:06.000Z',
    old_snapshot: {
      snapshot_id: 'snapshot-old-v1',
      file_name: '采购合同-旧版.docx',
      storage_path: 'org-a/contracts/old.docx',
      file_sha256: SHA_A,
      text_sha256: SHA_B,
      captured_at: '2026-07-18T01:00:00.000Z',
      immutable_at_creation: true,
    },
    new_snapshot: {
      snapshot_id: 'snapshot-new-v2',
      file_name: '采购合同-客户回传.docx',
      storage_path: 'org-a/contracts/new.docx',
      file_sha256: SHA_C,
      text_sha256: SHA_D,
      captured_at: '2026-07-18T02:00:00.000Z',
      immutable_at_creation: true,
    },
    statistics: {
      total: 2,
      added: 0,
      deleted: 0,
      modified: 1,
      moved: 1,
      red: 1,
      yellow: 1,
      green: 0,
    },
    diffs: [
      {
        id: 'diff-later',
        sort_order: 20,
        type: 'moved',
        risk: 'yellow',
        old_source_text: '第八条 原位置文本',
        new_source_text: '第十条 新位置文本',
        old_position: { page_number: 3, start_offset: 180, end_offset: 194, locator: 'provisional' },
        new_position: { page_number: 4, start_offset: 260, end_offset: 274, locator: 'provisional' },
      },
      {
        id: 'diff-first',
        sort_order: 10,
        type: 'modified',
        risk: 'red',
        old_source_text: '付款期限为 30 日 & 不可单方变更',
        new_source_text: '付款期限改为 90 日 <需审批>',
        old_position: { page_number: 1, start_offset: 24, end_offset: 42, locator: 'rendered' },
        new_position: { page_number: 2, start_offset: 36, end_offset: 53, locator: 'rendered' },
      },
    ],
  }
}

async function unzipDocument(input = validInput()) {
  const report = await generateComparisonReportDocx(input)
  const zip = await JSZip.loadAsync(report.buffer)
  const documentXml = await zip.file('word/document.xml')?.async('string')
  return { report, zip, documentXml: documentXml || '' }
}

describe('comparison report DOCX', () => {
  it('creates a standalone OOXML package containing immutable identities, statistics, positions, and both source texts', async () => {
    const { report, zip, documentXml } = await unzipDocument()

    expect(report.mimeType).toBe(COMPARISON_REPORT_MIME_TYPE)
    expect(report.filename).toBe('comparison-cmp-20260718-001-difference-report.docx')
    expect(report.buffer.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    expect(Object.keys(zip.files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/',
      '_rels/.rels',
      'docProps/',
      'docProps/app.xml',
      'docProps/core.xml',
      'word/',
      'word/_rels/',
      'word/_rels/document.xml.rels',
      'word/document.xml',
      'word/styles.xml',
    ])

    const contentTypes = await zip.file('[Content_Types].xml')?.async('string')
    const rootRelationships = await zip.file('_rels/.rels')?.async('string')
    expect(contentTypes).toContain('wordprocessingml.document.main+xml')
    expect(rootRelationships).toContain('officeDocument')
    expect(rootRelationships).toContain('word/document.xml')
    expect(documentXml).toContain('合同文档差异报告')
    expect(documentXml).toContain('cmp-20260718-001')
    expect(documentXml).toContain('比对完成时间：2026-07-18T02:05:06.000Z')
    expect(documentXml).toContain('snapshot-old-v1')
    expect(documentXml).toContain('snapshot-new-v2')
    expect(documentXml).toContain(SHA_A)
    expect(documentXml).toContain(SHA_D)
    expect(documentXml).toContain('真实渲染页码：第 1 页；原文 UTF-16 偏移 [24, 42)')
    expect(documentXml).toContain('真实渲染页码：第 2 页；原文 UTF-16 偏移 [36, 53)')
    expect(documentXml).toContain('临时位置（非真实页码）；原文 UTF-16 偏移 [180, 194)')
    expect(documentXml).not.toContain('第 3 页')
    expect(documentXml).not.toContain('第 4 页')
    expect(documentXml).toContain('付款期限为 30 日 &amp; 不可单方变更')
    expect(documentXml).toContain('付款期限改为 90 日 &lt;需审批&gt;')
    expect(documentXml).toContain('修改 · 红线 · diff-first')
    expect(documentXml).toContain('移动 · 需关注 · diff-later')
  })

  it('fails closed when either snapshot identity, file SHA, text SHA, or immutable marker is missing', async () => {
    for (const mutate of [
      (input: MutableRecord) => { delete mutableRecord(input.old_snapshot).snapshot_id },
      (input: MutableRecord) => { delete mutableRecord(input.old_snapshot).file_sha256 },
      (input: MutableRecord) => { delete mutableRecord(input.new_snapshot).text_sha256 },
      (input: MutableRecord) => { mutableRecord(input.new_snapshot).immutable_at_creation = false },
    ]) {
      const input = structuredClone(validInput()) as unknown as MutableRecord
      mutate(input)
      await expect(generateComparisonReportDocx(input)).rejects.toBeInstanceOf(ComparisonReportValidationError)
    }
  })

  it('fails closed when the completion time or either locator truth is missing', async () => {
    for (const mutate of [
      (input: MutableRecord) => { delete input.completed_at },
      (input: MutableRecord) => { input.completed_at = 'not-a-time' },
      (input: MutableRecord) => { delete mutableRecord(firstDiff(input).old_position).locator },
      (input: MutableRecord) => { mutableRecord(firstDiff(input).new_position).locator = 'guessed' },
    ]) {
      const input = structuredClone(validInput()) as unknown as MutableRecord
      mutate(input)
      await expect(generateComparisonReportDocx(input)).rejects.toBeInstanceOf(ComparisonReportValidationError)
    }
  })

  it('fails closed when a diff lacks either source text or either exact source position', async () => {
    for (const mutate of [
      (input: MutableRecord) => { firstDiff(input).old_source_text = '' },
      (input: MutableRecord) => { delete firstDiff(input).new_source_text },
      (input: MutableRecord) => { delete mutableRecord(firstDiff(input).old_position).page_number },
      (input: MutableRecord) => { delete firstDiff(input).new_position },
    ]) {
      const input = structuredClone(validInput()) as unknown as MutableRecord
      mutate(input)
      await expect(generateComparisonReportDocx(input)).rejects.toBeInstanceOf(ComparisonReportValidationError)
    }
  })

  it('accepts truthful added and deleted items with an empty-side insertion point', async () => {
    const input = validInput()
    input.statistics = {
      total: 2,
      added: 1,
      deleted: 1,
      modified: 0,
      moved: 0,
      red: 1,
      yellow: 1,
      green: 0,
    }
    input.diffs = [
      {
        id: 'added-1',
        sort_order: 1,
        type: 'added',
        risk: 'yellow',
        old_source_text: '',
        new_source_text: '新增的验收条款',
        old_position: { page_number: 1, start_offset: 40, end_offset: 40, locator: 'provisional' },
        new_position: { page_number: 1, start_offset: 40, end_offset: 48, locator: 'provisional' },
      },
      {
        id: 'deleted-1',
        sort_order: 2,
        type: 'deleted',
        risk: 'red',
        old_source_text: '删除的违约条款',
        new_source_text: '',
        old_position: { page_number: 2, start_offset: 80, end_offset: 88, locator: 'rendered' },
        new_position: { page_number: 2, start_offset: 80, end_offset: 80, locator: 'rendered' },
      },
    ]

    const { documentXml } = await unzipDocument(input)
    expect(documentXml).toContain('新增的验收条款')
    expect(documentXml).toContain('删除的违约条款')
    expect(documentXml).toContain('（无，对应位置为插入点）')
  })

  it('rejects statistics that do not exactly match the diff details', async () => {
    const input = validInput()
    input.statistics.red = 0
    input.statistics.green = 1

    await expect(generateComparisonReportDocx(input)).rejects.toThrow('statistics.red 与差异明细不一致')
  })

  it('sorts details deterministically and returns a stable filename and package bytes', async () => {
    const first = await unzipDocument()
    const second = await unzipDocument()

    expect(first.documentXml.indexOf('diff-first')).toBeLessThan(first.documentXml.indexOf('diff-later'))
    expect(first.report.filename).toBe(buildComparisonReportFilename('cmp-20260718-001'))
    expect(second.report.filename).toBe(first.report.filename)
    expect(createHash('sha256').update(second.report.buffer).digest('hex'))
      .toBe(createHash('sha256').update(first.report.buffer).digest('hex'))
  })
})
