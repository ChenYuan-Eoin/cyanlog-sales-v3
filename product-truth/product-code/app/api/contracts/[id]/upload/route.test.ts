// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth', () => ({ requireAuth: vi.fn() }))
vi.mock('@/lib/scoped-access', () => ({
  canAccessContractAction: vi.fn(),
  listFreshAccessibleUserIds: vi.fn(),
}))
vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: { from: vi.fn(), storage: { from: vi.fn() } },
}))
vi.mock('@/lib/error-log', () => ({ logError: vi.fn() }))
vi.mock('@/lib/documents/source-page-map', () => {
  class SourcePreparationError extends Error {
    constructor(readonly code: string, message: string) { super(message) }
  }
  return { prepareContractSource: vi.fn(), SourcePreparationError }
})
vi.mock('@/lib/documents/source-ingestion', () => {
  class SourceFinalizationError extends Error {
    constructor(readonly code: string, message: string, readonly status: number) { super(message) }
  }
  return {
    deterministicSourceStoragePath: vi.fn((id: string, uploadId: string) => `${id}/${uploadId}/source`),
    finalizeContractSourceUpload: vi.fn(),
    SourceFinalizationError,
  }
})

import { POST } from './route'
import { requireAuth } from '@/lib/auth'
import {
  canAccessContractAction,
  listFreshAccessibleUserIds,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { prepareContractSource, SourcePreparationError } from '@/lib/documents/source-page-map'
import { finalizeContractSourceUpload } from '@/lib/documents/source-ingestion'
import { stableSourceUploadId } from '@/lib/documents/chunk-upload-protocol'

const CONTRACT_ID = 'd36fe9ff-b22d-4df1-83ae-843b65a1f54c'
const context = { params: Promise.resolve({ id: CONTRACT_ID }) }
const readyPreparation = {
  status: 'READY' as const,
  reason: null,
  format: 'pdf' as const,
  mimeType: 'application/pdf',
  sourceHash: 'a'.repeat(64),
  sourceTextHash: 'b'.repeat(64),
  parsedText: 'Contract body',
  renderMode: 'native-pdf' as const,
  pageMap: {
    page_count: 1,
    locator: 'provisional' as const,
    pages: [{ page: 1, start: 0, end: 12, locator: 'provisional' as const }],
  },
}

function formRequest(file?: File, purpose?: 'source' | 'manual_revision' | 'customer-return') {
  return {
    formData: async () => {
      const form = new FormData()
      if (file) form.set('file', file)
      if (purpose) form.set('purpose', purpose)
      return form
    },
  } as any
}

function arrangeContract(data: unknown = {
  id: CONTRACT_ID,
  org_id: 'org-1',
  status: 'DRAFT',
  storage_path: null,
  filename: null,
  size: null,
  mime_type: null,
  updated_at: '2026-07-21T10:00:00.000Z',
}) {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    maybeSingle: vi.fn().mockResolvedValue({
      data,
      error: null,
    }),
  }
  vi.mocked(supabaseAdmin.from).mockReturnValue(query)
  vi.mocked(supabaseAdmin.storage.from).mockReturnValue({
    getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://storage.test/source' } }),
  } as never)
  return query
}

describe('POST /api/contracts/[id]/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ id: 'user-1' } as never)
    vi.mocked(listFreshAccessibleUserIds).mockResolvedValue({
      orgId: 'org-1',
      assignments: [],
      userIds: ['user-1'],
    })
    vi.mocked(canAccessContractAction).mockReturnValue(true)
    vi.mocked(prepareContractSource).mockResolvedValue(readyPreparation)
    vi.mocked(finalizeContractSourceUpload).mockResolvedValue({
      contractId: CONTRACT_ID,
      storagePath: `${CONTRACT_ID}/source-hash_contract.pdf`,
      fileName: 'contract.pdf',
      fileSize: 32,
      fileType: 'application/pdf',
      sourceHash: 'a'.repeat(64),
      sourceTextHash: 'b'.repeat(64),
      preparationStatus: 'READY',
      preparationReason: null,
      reviewReady: true,
      renderMode: 'native-pdf',
      pageMapLocator: 'provisional',
      versionId: 'version-1',
      versionNumber: 1,
      versionSource: 'original',
      recovered: false,
      contractStatus: 'PENDING',
    })
  })

  it('rejects malformed multipart and missing files before database or storage work', async () => {
    const malformed = await POST({ formData: async () => { throw new TypeError() } } as any, context)
    expect(malformed.status).toBe(400)
    const missing = await POST(formRequest(), context)
    expect(missing.status).toBe(400)
    expect(listFreshAccessibleUserIds).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
  })

  it('fails closed on invalid source bytes before organization lookup', async () => {
    vi.mocked(prepareContractSource).mockRejectedValue(
      new SourcePreparationError('INVALID_SOURCE', '文件内容不是有效的 PDF 格式'),
    )
    const response = await POST(formRequest(new File(['invalid'], 'contract.pdf', { type: 'application/pdf' })), context)
    expect(response.status).toBe(400)
    expect(listFreshAccessibleUserIds).not.toHaveBeenCalled()
  })

  it('returns the auditable source identity and version after direct source finalization', async () => {
    arrangeContract()
    const response = await POST(formRequest(new File(['%PDF-1.7\n(Body) Tj'], 'contract.pdf', { type: 'application/pdf' })), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      sourceHash: 'a'.repeat(64),
      sourceTextHash: 'b'.repeat(64),
      reviewReady: true,
      versionId: 'version-1',
      contractUpdated: true,
    })
    expect(finalizeContractSourceUpload).toHaveBeenCalledWith(expect.objectContaining({
      preparation: readyPreparation,
      uploadId: await stableSourceUploadId(CONTRACT_ID, 'a'.repeat(64)),
    }))
  })

  it('拒绝没有创建或上传能力的用户且不查询合同或写入 Storage', async () => {
    vi.mocked(canAccessContractAction).mockReturnValue(false)

    const response = await POST(formRequest(
      new File(['%PDF-1.7\n(Body) Tj'], 'contract.pdf', { type: 'application/pdf' }),
    ), context)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.code).toBe('A002')
    expect(canAccessContractAction).toHaveBeenCalledWith([], 'org-1', 'create_or_upload')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('exposes a saved PDF as awaiting OCR without a fabricated review identity', async () => {
    arrangeContract()
    vi.mocked(prepareContractSource).mockResolvedValue({
      status: 'AWAITING_OCR',
      reason: 'PDF_TEXT_UNAVAILABLE',
      format: 'pdf',
      mimeType: 'application/pdf',
      sourceHash: 'c'.repeat(64),
      sourceTextHash: null,
      parsedText: null,
      renderMode: 'native-pdf',
      pageMap: null,
    })
    vi.mocked(finalizeContractSourceUpload).mockResolvedValue({
      contractId: CONTRACT_ID,
      storagePath: `${CONTRACT_ID}/scan.pdf`,
      fileName: 'scan.pdf',
      fileSize: 16,
      fileType: 'application/pdf',
      sourceHash: 'c'.repeat(64),
      sourceTextHash: null,
      preparationStatus: 'AWAITING_OCR',
      preparationReason: 'PDF_TEXT_UNAVAILABLE',
      reviewReady: false,
      renderMode: 'native-pdf',
      pageMapLocator: null,
      versionId: 'version-scan',
      versionNumber: 1,
      versionSource: 'original',
      recovered: false,
      contractStatus: 'DRAFT',
    } as any)

    const response = await POST(formRequest(new File(['%PDF-1.7\n%%EOF'], 'scan.pdf', { type: 'application/pdf' })), context)
    expect(response.status).toBe(200)
    expect((await response.json()).data).toMatchObject({
      preparationStatus: 'AWAITING_OCR',
      sourceTextHash: null,
      reviewReady: false,
      pageMapLocator: null,
    })
  })

  it('preserves legacy DOC as conversion-required and never reports it review-ready', async () => {
    arrangeContract()
    const legacyPreparation = {
      status: 'AWAITING_CONVERSION' as const,
      reason: 'LEGACY_DOC_REQUIRES_CONVERSION' as const,
      format: 'doc' as const,
      mimeType: 'application/msword',
      sourceHash: 'd'.repeat(64),
      sourceTextHash: null,
      parsedText: null,
      renderMode: 'identity-only' as const,
      pageMap: null,
    }
    vi.mocked(prepareContractSource).mockResolvedValue(legacyPreparation)
    vi.mocked(finalizeContractSourceUpload).mockResolvedValue({
      contractId: CONTRACT_ID,
      storagePath: `${CONTRACT_ID}/legacy/source`,
      fileName: 'legacy.doc',
      fileSize: 8,
      fileType: 'application/msword',
      sourceHash: 'd'.repeat(64),
      sourceTextHash: null,
      preparationStatus: 'AWAITING_CONVERSION',
      preparationReason: 'LEGACY_DOC_REQUIRES_CONVERSION',
      reviewReady: false,
      renderMode: 'identity-only',
      pageMapLocator: null,
      versionId: 'version-doc',
      versionNumber: 1,
      versionSource: 'original',
      recovered: false,
      contractStatus: 'DRAFT',
    })

    const response = await POST(formRequest(new File([
      new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    ], 'legacy.doc', { type: 'application/msword' })), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      preparationStatus: 'AWAITING_CONVERSION',
      preparationReason: 'LEGACY_DOC_REQUIRES_CONVERSION',
      reviewReady: false,
      renderMode: 'identity-only',
      pageMapLocator: null,
      contractStatus: 'DRAFT',
    })
    expect(finalizeContractSourceUpload).toHaveBeenCalledWith(expect.objectContaining({
      preparation: legacyPreparation,
    }))
  })

  it('uses the same atomic source finalizer for customer-return versions', async () => {
    arrangeContract()
    const response = await POST(
      formRequest(
        new File(['%PDF-1.7\n(Body) Tj'], 'return.pdf', { type: 'application/pdf' }),
        'customer-return',
      ),
      context,
    )

    expect(response.status).toBe(200)
    expect(finalizeContractSourceUpload).toHaveBeenCalledTimes(1)
    expect((await response.json()).data).toMatchObject({
      uploadPurpose: 'customer-return',
      contractUpdated: true,
    })
  })

  it('enforces organization and accessible-user boundaries before finalization', async () => {
    const query = arrangeContract(null)
    const response = await POST(
      formRequest(new File(['%PDF-1.7\n(Body) Tj'], 'contract.pdf', { type: 'application/pdf' })),
      context,
    )

    expect(response.status).toBe(404)
    expect(query.eq).toHaveBeenCalledWith('id', CONTRACT_ID)
    expect(query.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(query.in).toHaveBeenCalledWith('created_by', ['user-1'])
    expect(finalizeContractSourceUpload).not.toHaveBeenCalled()
  })
})
