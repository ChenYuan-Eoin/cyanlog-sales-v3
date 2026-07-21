// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */

import { createHash } from 'node:crypto'
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
vi.mock('@/lib/documents/source-ingestion', () => {
  class SourceFinalizationError extends Error {
    constructor(readonly code: string, message: string, readonly status: number) {
      super(message)
    }
  }
  return { finalizeContractSourceUpload: vi.fn(), SourceFinalizationError }
})

import { POST } from './route'
import { requireAuth } from '@/lib/auth'
import {
  canAccessContractAction,
  listFreshAccessibleUserIds,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import { finalizeContractSourceUpload, SourceFinalizationError } from '@/lib/documents/source-ingestion'
import { chunkObjectPath, uploadCancellationPath } from '@/lib/documents/chunk-upload-protocol'

const contractId = 'd36fe9ff-b22d-4df1-83ae-843b65a1f54c'
const uploadId = '5f10282d-9d09-8f8b-8e41-e2757979c213'
const bytes = Buffer.from('%PDF-1.7\n(Contract body) Tj\n%%EOF')
const sha256 = createHash('sha256').update(bytes).digest('hex')
const chunkPath = chunkObjectPath(contractId, uploadId, 0)
const markerPath = uploadCancellationPath(contractId, uploadId)
const context = { params: Promise.resolve({ id: contractId }) }

function request(overrides: Record<string, unknown> = {}) {
  return {
    json: async () => ({
      fileName: 'contract.pdf',
      fileType: 'application/pdf',
      totalSize: bytes.byteLength,
      chunkCount: 1,
      uploadId,
      expectedSha256: sha256,
      ...overrides,
    }),
  } as any
}

function arrangeSuccessfulDependencies(contractData: unknown = {
  id: contractId,
  org_id: 'org-1',
  status: 'DRAFT',
  storage_path: null,
  filename: null,
  size: null,
  mime_type: null,
  updated_at: '2026-07-21T10:00:00.000Z',
}) {
  const contractQuery: any = {
    select: vi.fn(() => contractQuery),
    eq: vi.fn(() => contractQuery),
    in: vi.fn(() => contractQuery),
    maybeSingle: vi.fn().mockResolvedValue({
      data: contractData,
      error: null,
    }),
  }
  vi.mocked(supabaseAdmin.from).mockReturnValue(contractQuery)

  const temp = {
    download: vi.fn(async (path: string) => path === chunkPath
      ? { data: new Blob([bytes]), error: null }
      : path === markerPath
        ? { data: null, error: { statusCode: 404, message: 'not found' } }
        : { data: null, error: { statusCode: 404, message: 'not found' } }),
    remove: vi.fn().mockResolvedValue({ error: null }),
  }
  const final = {
    getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://storage.test/source' } }),
  }
  vi.mocked(supabaseAdmin.storage.from).mockImplementation(((bucket: string) => (
    bucket === 'contract-chunks' ? temp : final
  )) as any)

  vi.mocked(finalizeContractSourceUpload).mockResolvedValue({
    contractId,
    storagePath: `${contractId}/${uploadId}/source`,
    fileName: 'contract.pdf',
    fileSize: bytes.byteLength,
    fileType: 'application/pdf',
    sourceHash: sha256,
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
  return { contractQuery, temp }
}

describe('POST /api/contracts/[id]/merge-chunks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ id: 'user-1' } as never)
    vi.mocked(listFreshAccessibleUserIds).mockResolvedValue({
      orgId: 'org-1',
      assignments: [],
      userIds: ['user-1'],
    })
    vi.mocked(canAccessContractAction).mockReturnValue(true)
  })

  it('rejects malformed and incomplete input before organization or storage work', async () => {
    const malformed = await POST({ json: async () => { throw new SyntaxError() } } as any, context)
    expect(malformed.status).toBe(400)
    expect((await malformed.json()).error.code).toBe('V002')

    const missing = await POST({ json: async () => ({}) } as any, context)
    expect(missing.status).toBe(400)
    expect((await missing.json()).error.code).toBe('V003')
    expect(listFreshAccessibleUserIds).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('rejects an arbitrary UUID before organization lookup or chunk download', async () => {
    const response = await POST(request({
      uploadId: '019f6d1a-3b21-7cc0-8f4e-123456789abc',
    }), context)

    expect(response.status).toBe(400)
    expect((await response.json()).error.message).toContain('合同及文件摘要不一致')
    expect(listFreshAccessibleUserIds).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('stops at the organization boundary before reading temporary chunks', async () => {
    const { contractQuery } = arrangeSuccessfulDependencies(null)
    const response = await POST(request(), context)

    expect(response.status).toBe(404)
    expect(contractQuery.eq).toHaveBeenCalledWith('id', contractId)
    expect(contractQuery.eq).toHaveBeenCalledWith('org_id', 'org-1')
    expect(contractQuery.in).toHaveBeenCalledWith('created_by', ['user-1'])
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('没有创建或上传能力时不查询合同也不读取临时分块', async () => {
    vi.mocked(canAccessContractAction).mockReturnValue(false)

    const response = await POST(request(), context)

    expect(response.status).toBe(403)
    expect(canAccessContractAction).toHaveBeenCalledWith([], 'org-1', 'create_or_upload')
    expect(supabaseAdmin.from).not.toHaveBeenCalled()
    expect(supabaseAdmin.storage.from).not.toHaveBeenCalled()
  })

  it('verifies all bytes and SHA, finalizes once, then cleans temporary chunks', async () => {
    const { temp } = arrangeSuccessfulDependencies()
    const response = await POST(request(), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.data).toMatchObject({
      sourceHash: sha256,
      sourceTextHash: 'b'.repeat(64),
      reviewReady: true,
      pageMapLocator: 'provisional',
      chunksCleaned: true,
    })
    expect(finalizeContractSourceUpload).toHaveBeenCalledWith(expect.objectContaining({
      uploadId,
      bytes: expect.any(Uint8Array),
    }))
    expect(temp.remove).toHaveBeenCalledWith([chunkPath])
  })

  it('retains chunks when finalization fails so the same session can retry', async () => {
    const { temp } = arrangeSuccessfulDependencies()
    vi.mocked(finalizeContractSourceUpload).mockRejectedValue(
      new SourceFinalizationError('SOURCE_IDENTITY_FAILED', '页图尚未完成', 500),
    )

    const response = await POST(request(), context)

    expect(response.status).toBe(500)
    expect(temp.remove).not.toHaveBeenCalled()
  })

  it('rejects a whole-file digest mismatch without finalization or cleanup', async () => {
    const { temp } = arrangeSuccessfulDependencies()
    const response = await POST(request({ expectedSha256: 'a'.repeat(64) }), context)

    expect(response.status).toBe(400)
    expect(finalizeContractSourceUpload).not.toHaveBeenCalled()
    expect(temp.remove).not.toHaveBeenCalled()
  })
})
