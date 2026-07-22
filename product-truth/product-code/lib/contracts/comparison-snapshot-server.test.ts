// @vitest-environment node

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import {
  cleanupUnreferencedFrozenSources,
  downloadFrozenComparisonSource,
  type FrozenComparisonSource,
} from './comparison-snapshot-server'

let sourceSequence = 0

function frozenSource(bytes: Buffer): FrozenComparisonSource {
  sourceSequence += 1
  const parsedText = '冻结正文'
  return {
    id: `source-${sourceSequence}`,
    comparison_id: `comparison-${sourceSequence}`,
    org_id: 'org-1',
    role: 'old',
    contract_id: `contract-${sourceSequence}`,
    origin_storage_path: `origin/${sourceSequence}/source.docx`,
    storage_path: `g6-frozen/org-1/${sourceSequence}/old-source.docx`,
    file_name: 'source.docx',
    file_size: bytes.byteLength,
    mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    file_sha256: createHash('sha256').update(bytes).digest('hex'),
    text_sha256: createHash('sha256').update(parsedText).digest('hex'),
    parsed_text: parsedText,
    text_reliability: 'verified',
    render_mode: 'browser-ooxml',
    page_map: {
      page_count: 1,
      locator: 'provisional',
      pages: [{ page: 1, start: 0, end: parsedText.length - 1, locator: 'provisional' }],
    },
    captured_at: '2026-07-18T00:00:00.000Z',
  }
}

function referenceQuery(result: { data: unknown[] | null; error: Error | null }) {
  return {
    select: vi.fn().mockReturnThis(),
    in: vi.fn().mockResolvedValue(result),
  }
}

describe('cleanupUnreferencedFrozenSources', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('fails closed without calling Storage when reference verification fails', async () => {
    const query = referenceQuery({ data: null, error: new Error('database unavailable') })
    vi.mocked(supabaseAdmin.from).mockReturnValue(query as never)

    const result = await cleanupUnreferencedFrozenSources(['g6-frozen/org-1/a/source.docx'])

    expect(result).toMatchObject({
      status: 'verification_failed',
      requested_count: 1,
      removed_count: 0,
      retained_count: 1,
    })
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('removes only paths confirmed unreferenced and preserves referenced snapshots', async () => {
    const referenced = 'g6-frozen/org-1/a/old.docx'
    const unreferenced = 'g6-frozen/org-1/b/new.docx'
    const query = referenceQuery({
      data: [{ storage_path: referenced, comparison_id: 'comparison-1' }],
      error: null,
    })
    const remove = vi.fn().mockResolvedValue({ data: [], error: null })
    vi.mocked(supabaseAdmin.from).mockReturnValue(query as never)
    vi.mocked(supabaseAdmin.storage.from).mockReturnValue({ remove } as never)

    const result = await cleanupUnreferencedFrozenSources([referenced, unreferenced])

    expect(remove).toHaveBeenCalledWith([unreferenced])
    expect(result).toEqual({
      status: 'complete',
      requested_count: 2,
      referenced_count: 1,
      removed_count: 1,
      retained_count: 1,
      comparison_ids: ['comparison-1'],
    })
  })

  it('reports Storage remove errors instead of treating a resolved response as success', async () => {
    const path = 'g6-frozen/org-1/a/source.docx'
    vi.mocked(supabaseAdmin.from).mockReturnValue(referenceQuery({ data: [], error: null }) as never)
    vi.mocked(supabaseAdmin.storage.from).mockReturnValue({
      remove: vi.fn().mockResolvedValue({ data: null, error: new Error('remove denied') }),
    } as never)

    const result = await cleanupUnreferencedFrozenSources([path])

    expect(result).toMatchObject({
      status: 'removal_failed',
      requested_count: 1,
      removed_count: 0,
      retained_count: 1,
    })
  })

  it('refuses non-G6 paths before querying or deleting anything', async () => {
    const result = await cleanupUnreferencedFrozenSources(['ordinary-contract/source.docx'])

    expect(result.status).toBe('verification_failed')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })
})

describe('downloadFrozenComparisonSource cache controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses the verified process cache for ordinary reads', async () => {
    const bytes = Buffer.from('cached-frozen-bytes')
    const source = frozenSource(bytes)
    const download = vi.fn().mockResolvedValue({
      data: new Blob([Uint8Array.from(bytes)]),
      error: null,
    })
    vi.mocked(supabaseAdmin.storage.from).mockReturnValue({ download } as never)

    await downloadFrozenComparisonSource(source)
    await downloadFrozenComparisonSource(source)

    expect(download).toHaveBeenCalledOnce()
  })

  it('forceStorageVerification bypasses memory and fetch caches so a missing object is visible', async () => {
    const bytes = Buffer.from('force-verified-frozen-bytes')
    const source = frozenSource(bytes)
    const download = vi.fn()
      .mockResolvedValueOnce({
        data: new Blob([Uint8Array.from(bytes)]),
        error: null,
      })
      .mockResolvedValueOnce({ data: null, error: new Error('object not found') })
    vi.mocked(supabaseAdmin.storage.from).mockReturnValue({ download } as never)

    await downloadFrozenComparisonSource(source)
    await expect(downloadFrozenComparisonSource(source, { forceStorageVerification: true }))
      .rejects.toThrow('冻结原文件下载失败')

    expect(download).toHaveBeenCalledTimes(2)
    expect(download.mock.calls[1][0]).toBe(source.storage_path)
    expect(download.mock.calls[1][1]).toEqual({ cacheNonce: expect.any(String) })
    expect(download.mock.calls[1][2]).toEqual({ cache: 'no-store' })
  })

  it('bypassCache skips only the process cache and still revalidates size and SHA', async () => {
    const bytes = Buffer.from('bypass-memory-cache')
    const source = frozenSource(bytes)
    const download = vi.fn().mockResolvedValue({
      data: new Blob([Uint8Array.from(bytes)]),
      error: null,
    })
    vi.mocked(supabaseAdmin.storage.from).mockReturnValue({ download } as never)

    await downloadFrozenComparisonSource(source)
    await downloadFrozenComparisonSource(source, { bypassCache: true })

    expect(download).toHaveBeenCalledTimes(2)
    expect(download.mock.calls[1]).toEqual([source.storage_path])
  })
})
