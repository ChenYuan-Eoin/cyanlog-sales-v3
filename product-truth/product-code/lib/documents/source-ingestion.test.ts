// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    rpc: vi.fn(),
    storage: { from: vi.fn() },
  },
}))

import { supabaseAdmin } from '@/lib/supabase'
import {
  deterministicSourceStoragePath,
  finalizeContractSourceUpload,
  SourceFinalizationError,
} from './source-ingestion'

const CONTRACT_ID = 'd36fe9ff-b22d-4df1-83ae-843b65a1f54c'
const USER_ID = 'fa17ef8a-1df5-4ab0-8c34-8aa8be31701c'
const ORG_ID = '45029d70-aa5e-4790-b90b-5bbdb8f07f10'
const UPLOAD_ID = '05387955-faef-8a47-b795-ac5c947f5e51'
const bytes = new TextEncoder().encode('contract body')
const fileHash = createHash('sha256').update(bytes).digest('hex')

const readyPreparation = {
  status: 'READY' as const,
  reason: null,
  format: 'pdf' as const,
  mimeType: 'application/pdf',
  sourceHash: fileHash,
  sourceTextHash: createHash('sha256').update('contract body').digest('hex'),
  parsedText: 'contract body',
  renderMode: 'native-pdf' as const,
  pageMap: {
    page_count: 1,
    locator: 'provisional' as const,
    pages: [{ page: 1, start: 0, end: 13, locator: 'provisional' as const }],
  },
}

const awaitingOcrPreparation = {
  status: 'AWAITING_OCR' as const,
  reason: 'PDF_TEXT_UNAVAILABLE' as const,
  format: 'pdf' as const,
  mimeType: 'application/pdf',
  sourceHash: fileHash,
  sourceTextHash: null,
  parsedText: null,
  renderMode: 'native-pdf' as const,
  pageMap: null,
}

const awaitingConversionPreparation = {
  status: 'AWAITING_CONVERSION' as const,
  reason: 'LEGACY_DOC_REQUIRES_CONVERSION' as const,
  format: 'doc' as const,
  mimeType: 'application/msword',
  sourceHash: fileHash,
  sourceTextHash: null,
  parsedText: null,
  renderMode: 'identity-only' as const,
  pageMap: null,
}

const contract = {
  id: CONTRACT_ID,
  org_id: ORG_ID,
  status: 'DRAFT',
  storage_path: null,
  filename: null,
  size: null,
  mime_type: null,
  updated_at: '2026-07-21T10:00:00.000Z',
}

const storage = {
  upload: vi.fn(),
  download: vi.fn(),
  remove: vi.fn(),
}

function input(
  preparation:
    | typeof readyPreparation
    | typeof awaitingOcrPreparation
    | typeof awaitingConversionPreparation = readyPreparation,
) {
  return {
    contract,
    orgId: ORG_ID,
    userId: USER_ID,
    fileName: preparation.status === 'AWAITING_CONVERSION' ? 'legacy.doc' : 'contract.pdf',
    fileType: preparation.mimeType,
    bytes,
    uploadId: UPLOAD_ID,
    preparation,
  }
}

function makeQuery(result: { data: unknown; error: unknown }) {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
  return query
}

function recoveryQuery(
  result: { data: unknown; error: unknown },
  currentContract: { data: unknown; error: unknown } = {
    data: {
      current_version_id: 'ef2b9bf1-600f-4fd5-a360-17cfcb2814cb',
      storage_path: deterministicSourceStoragePath(CONTRACT_ID, UPLOAD_ID, 'contract.pdf'),
    },
    error: null,
  },
) {
  const versionQuery = makeQuery(result)
  const contractQuery = makeQuery(currentContract)
  vi.mocked(supabaseAdmin.from)
    .mockReturnValueOnce(versionQuery)
    .mockReturnValueOnce(contractQuery)
  return { versionQuery, contractQuery }
}

describe('finalizeContractSourceUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabaseAdmin.storage.from).mockReturnValue(storage as never)
    storage.upload.mockResolvedValue({ error: null })
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: [{
        contract_version_id: 'f0d33f6b-e635-4fdb-a2da-cbb728431406',
        ingest_status: 'SOURCE_READY',
        version_number: 1,
        version_source: 'original',
        recovered: false,
      }],
      error: null,
    } as never)
  })

  it('writes immutable Storage first and delegates all source rows to one RPC', async () => {
    const result = await finalizeContractSourceUpload(input())

    const storagePath = deterministicSourceStoragePath(CONTRACT_ID, UPLOAD_ID, 'contract.pdf')
    expect(storage.upload).toHaveBeenCalledWith(storagePath, bytes, {
      contentType: 'application/pdf',
      upsert: false,
    })
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'finalize_contract_source_version',
      expect.objectContaining({
        p_contract_id: CONTRACT_ID,
        p_upload_id: UPLOAD_ID,
        p_storage_path: storagePath,
        p_file_sha256: fileHash,
        p_ingest_status: 'SOURCE_READY',
        p_ingest_error: null,
        p_page_map: readyPreparation.pageMap.pages,
      }),
    )
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(storage.remove).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      versionId: 'f0d33f6b-e635-4fdb-a2da-cbb728431406',
      reviewReady: true,
      recovered: false,
    })
  })

  it('commits AWAITING_OCR as a successful stored result without a fake page map', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: [{
        contract_version_id: 'b43574b1-ae3d-47ba-9e55-b63e44534c10',
        ingest_status: 'AWAITING_OCR',
        version_number: 1,
        version_source: 'original',
        recovered: false,
      }],
      error: null,
    } as never)

    const result = await finalizeContractSourceUpload(input(awaitingOcrPreparation))

    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'finalize_contract_source_version',
      expect.objectContaining({
        p_ingest_status: 'AWAITING_OCR',
        p_ingest_error: 'PDF_TEXT_UNAVAILABLE',
        p_parsed_text: null,
        p_text_sha256: null,
        p_render_mode: null,
        p_locator: null,
        p_page_count: null,
        p_page_map: null,
      }),
    )
    expect(result).toMatchObject({
      preparationStatus: 'AWAITING_OCR',
      reviewReady: false,
      contractStatus: 'DRAFT',
    })
  })

  it('stores legacy DOC as AWAITING_CONVERSION and never publishes review identity', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: [{
        contract_version_id: 'aa583e26-d907-4fc0-8041-54d7164745e3',
        ingest_status: 'AWAITING_CONVERSION',
        version_number: 1,
        version_source: 'original',
        recovered: false,
      }],
      error: null,
    } as never)

    const result = await finalizeContractSourceUpload(input(awaitingConversionPreparation))

    expect(storage.upload).toHaveBeenCalledWith(
      deterministicSourceStoragePath(CONTRACT_ID, UPLOAD_ID, 'legacy.doc'),
      bytes,
      { contentType: 'application/msword', upsert: false },
    )
    expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
      'finalize_contract_source_version',
      expect.objectContaining({
        p_ingest_status: 'AWAITING_CONVERSION',
        p_ingest_error: 'LEGACY_DOC_REQUIRES_CONVERSION',
        p_parsed_text: null,
        p_text_sha256: null,
        p_render_mode: null,
        p_page_map: null,
      }),
    )
    expect(result).toMatchObject({
      preparationStatus: 'AWAITING_CONVERSION',
      preparationReason: 'LEGACY_DOC_REQUIRES_CONVERSION',
      reviewReady: false,
      renderMode: 'identity-only',
      pageMapLocator: null,
      contractStatus: 'DRAFT',
    })
  })

  it('rejects an arbitrary valid UUID before Storage or version finalization', async () => {
    await expect(finalizeContractSourceUpload({
      ...input(),
      uploadId: 'eeb43b5e-7b6d-8bbc-8f48-26d1e6db3f62',
    })).rejects.toMatchObject({
      code: 'SOURCE_IDENTITY_FAILED',
      status: 500,
    } satisfies Partial<SourceFinalizationError>)

    expect(storage.upload).not.toHaveBeenCalled()
    expect(supabaseAdmin.rpc).not.toHaveBeenCalled()
  })

  it('recovers an uncertain RPC response only from an exact upload/path/hash/status match', async () => {
    vi.mocked(supabaseAdmin.rpc).mockRejectedValue(new Error('upstream connection closed'))
    const storagePath = deterministicSourceStoragePath(CONTRACT_ID, UPLOAD_ID, 'contract.pdf')
    const { versionQuery, contractQuery } = recoveryQuery({
      data: {
        id: 'ef2b9bf1-600f-4fd5-a360-17cfcb2814cb',
        contract_id: CONTRACT_ID,
        storage_path: storagePath,
        file_sha256: fileHash,
        ingest_status: 'SOURCE_READY',
        version_number: 2,
        source: 'manual_revision',
      },
      error: null,
    })

    const result = await finalizeContractSourceUpload(input())

    expect(versionQuery.eq).toHaveBeenCalledWith('upload_id', UPLOAD_ID)
    expect(contractQuery.eq).toHaveBeenCalledWith('id', CONTRACT_ID)
    expect(result).toMatchObject({
      versionId: 'ef2b9bf1-600f-4fd5-a360-17cfcb2814cb',
      recovered: true,
      versionNumber: 2,
    })
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it('fails closed and retains the formal object when recovery identity conflicts', async () => {
    vi.mocked(supabaseAdmin.rpc).mockResolvedValue({
      data: null,
      error: { code: 'PGRST000', message: 'response unknown' },
    } as never)
    recoveryQuery({
      data: {
        id: 'ef2b9bf1-600f-4fd5-a360-17cfcb2814cb',
        contract_id: CONTRACT_ID,
        storage_path: deterministicSourceStoragePath(CONTRACT_ID, UPLOAD_ID, 'contract.pdf'),
        file_sha256: 'f'.repeat(64),
        ingest_status: 'SOURCE_READY',
        version_number: 1,
        source: 'original',
      },
      error: null,
    })

    await expect(finalizeContractSourceUpload(input())).rejects.toMatchObject({
      code: 'SOURCE_CONFLICT',
      status: 409,
    } satisfies Partial<SourceFinalizationError>)
    expect(storage.remove).not.toHaveBeenCalled()
  })

  it('does not recover an old upload after another source version became current', async () => {
    vi.mocked(supabaseAdmin.rpc).mockRejectedValue(new Error('upstream connection closed'))
    const storagePath = deterministicSourceStoragePath(CONTRACT_ID, UPLOAD_ID, 'contract.pdf')
    recoveryQuery({
      data: {
        id: 'ef2b9bf1-600f-4fd5-a360-17cfcb2814cb',
        contract_id: CONTRACT_ID,
        storage_path: storagePath,
        file_sha256: fileHash,
        ingest_status: 'SOURCE_READY',
        version_number: 2,
        source: 'manual_revision',
      },
      error: null,
    }, {
      data: {
        current_version_id: '2ebd4b29-c268-4598-b20d-4314f3af5cc1',
        storage_path: `${CONTRACT_ID}/newer/source`,
      },
      error: null,
    })

    await expect(finalizeContractSourceUpload(input())).rejects.toMatchObject({
      code: 'SOURCE_CONFLICT',
      status: 409,
    } satisfies Partial<SourceFinalizationError>)
    expect(storage.remove).not.toHaveBeenCalled()
  })
})
