import { describe, expect, it } from 'vitest'
import { deriveContractSourceReadiness } from './contract-source-readiness'

const fileHash = 'a'.repeat(64)
const textHash = 'b'.repeat(64)
const currentVersion = {
  id: 'version-1',
  source: 'original',
  storage_path: 'contracts/contract-1/source.docx',
  ingest_status: 'SOURCE_READY',
  ingest_error: null as string | null,
  file_sha256: fileHash,
  text_sha256: textHash,
}
const exactPageMap = {
  contract_version_id: currentVersion.id,
  storage_path: currentVersion.storage_path,
  source_hash: fileHash,
  source_text_hash: textHash,
  render_mode: 'browser-ooxml',
  locator: 'rendered',
  page_count: 3,
  generated_at: '2026-07-21T01:00:00.000Z',
}

function derive(overrides: {
  contractStoragePath?: string | null
  currentVersionId?: string | null
  versions?: Array<typeof currentVersion>
  pageMaps?: Array<typeof exactPageMap>
} = {}) {
  return deriveContractSourceReadiness({
    contractId: 'contract-1',
    contractStoragePath: overrides.contractStoragePath === undefined
      ? currentVersion.storage_path
      : overrides.contractStoragePath,
    currentVersionId: overrides.currentVersionId === undefined
      ? currentVersion.id
      : overrides.currentVersionId,
    versions: overrides.versions || [currentVersion],
    pageMaps: overrides.pageMaps || [exactPageMap],
  })
}

describe('deriveContractSourceReadiness', () => {
  it('allows review only when current version, hashes and page map agree', () => {
    expect(derive()).toMatchObject({
      state: 'ready',
      ready: true,
      can_start_review: true,
      source_version_id: 'version-1',
      recovery_action: null,
    })
  })

  it('fails closed with an upload action when no current source version exists', () => {
    const result = derive({ currentVersionId: null, versions: [], pageMaps: [] })

    expect(result).toMatchObject({
      state: 'missing',
      can_start_review: false,
      recovery_action: {
        id: 'upload_source',
        label: '补充审核源文件',
        href: '/contracts/contract-1/edit?intent=source-replacement',
      },
    })
    expect(result.description).toContain('DOC、DOCX、DOCM')
  })

  it('does not treat SOURCE_READY without a page map as reviewable', () => {
    expect(derive({ pageMaps: [] })).toMatchObject({
      state: 'missing',
      can_start_review: false,
      recovery_action: { label: '重新准备审核文件' },
    })
  })

  it('does not treat a stale path or hash mapping as reviewable', () => {
    const pathMismatch = derive({ contractStoragePath: 'contracts/contract-1/other.docx' })
    const hashMismatch = derive({
      pageMaps: [{ ...exactPageMap, source_hash: 'c'.repeat(64) }],
    })

    expect(pathMismatch).toMatchObject({
      state: 'stale',
      can_start_review: false,
      recovery_action: { label: '重新准备当前版本' },
    })
    expect(hashMismatch).toMatchObject({
      state: 'stale',
      can_start_review: false,
    })
  })

  it.each([
    ['AWAITING_OCR', 'waiting_ocr', '补传可检索 PDF'],
    ['AWAITING_CONVERSION', 'waiting_conversion', '补传 DOCX'],
    ['FAILED', 'failed', '重新上传审核文件'],
  ] as const)('returns a business recovery action for %s', (ingestStatus, state, actionLabel) => {
    const result = derive({
      versions: [{ ...currentVersion, ingest_status: ingestStatus }],
      pageMaps: [],
    })

    expect(result).toMatchObject({
      state,
      ready: false,
      can_start_review: false,
      recovery_action: {
        label: actionLabel,
        href: '/contracts/contract-1/edit?intent=source-replacement',
      },
    })
  })

  it('translates repaired legacy evidence gaps into a business recovery reason', () => {
    const result = derive({
      versions: [{
        ...currentVersion,
        ingest_status: 'FAILED',
        ingest_error: 'LEGACY_SOURCE_EVIDENCE_INCOMPLETE',
      }],
      pageMaps: [],
    })

    expect(result).toMatchObject({
      state: 'failed',
      can_start_review: false,
      failure_reason: expect.stringContaining('重新上传原文件'),
      recovery_action: { label: '重新上传审核文件' },
    })
    expect(result.failure_reason).not.toContain('LEGACY_SOURCE')
  })

  it('keeps in-progress preparation blocked without inventing a destructive recovery step', () => {
    expect(derive({
      versions: [{ ...currentVersion, ingest_status: 'PARSING' }],
      pageMaps: [],
    })).toMatchObject({
      state: 'preparing',
      can_start_review: false,
      recovery_action: null,
    })
  })
})
