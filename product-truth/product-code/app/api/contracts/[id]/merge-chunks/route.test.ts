/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({
  requireAuth: vi.fn(),
}))

vi.mock('@/lib/supabase', () => ({
  supabaseAdmin: {
    from: vi.fn(),
    storage: { from: vi.fn() },
  },
}))

vi.mock('@/lib/documents/source-format', () => ({
  inspectContractSource: vi.fn(),
}))

vi.mock('@/lib/documents/source-render', () => ({
  extractPdfText: vi.fn(),
}))

vi.mock('@/lib/documents/source-text', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/documents/source-text')>()
  return { ...actual, extractCurrentWordText: vi.fn() }
})

vi.mock('@/lib/error-log', () => ({
  logError: vi.fn(),
}))

import { POST } from './route'
import { requireAuth } from '@/lib/auth'
import { supabaseAdmin } from '@/lib/supabase'
import { inspectContractSource } from '@/lib/documents/source-format'
import { extractPdfText } from '@/lib/documents/source-render'
import { extractCurrentWordText } from '@/lib/documents/source-text'
import { logError } from '@/lib/error-log'
import {
  chunkObjectPath,
  uploadCancellationPath,
} from '@/lib/documents/chunk-upload-protocol'

const contractId = 'contract-1'
const uploadId = '019f6d1a-3b21-7cc0-8f4e-123456789abc'
const fileName = 'source.pdf'
const sourceBytes = Buffer.from('%PDF-test-source')
const expectedSha256 = createHash('sha256').update(sourceBytes).digest('hex')
const finalPath = `${contractId}/${uploadId}_${fileName}`
const markerPath = uploadCancellationPath(contractId, uploadId)
const chunkPath = chunkObjectPath(contractId, uploadId, 0)
const context = { params: Promise.resolve({ id: contractId }) }

function request() {
  return new NextRequest(`http://localhost/api/contracts/${contractId}/merge-chunks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fileName,
      fileType: 'application/pdf',
      totalSize: sourceBytes.byteLength,
      chunkCount: 1,
      uploadId,
      expectedSha256,
    }),
  })
}

function initialContractQuery(contract: Record<string, unknown>) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: contract, error: null }),
  }
}

function updateContractQuery(result: { data: unknown; error: unknown }) {
  return {
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
}

function latestContractQuery(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  }
}

function makeBuckets() {
  const finalBucket = {
    download: vi.fn(),
    upload: vi.fn(),
    remove: vi.fn().mockResolvedValue({ error: null }),
    getPublicUrl: vi.fn().mockReturnValue({
      data: { publicUrl: `https://storage.test/${finalPath}` },
    }),
  }
  const tempBucket = {
    download: vi.fn(),
    remove: vi.fn().mockResolvedValue({ error: null }),
  }

  vi.mocked(supabaseAdmin.storage.from).mockImplementation(((bucket: string) => {
    if (bucket === 'contracts') return finalBucket
    if (bucket === 'contract-chunks') return tempBucket
    throw new Error(`unexpected bucket ${bucket}`)
  }) as any)

  return { finalBucket, tempBucket }
}

function baseContract(overrides: Record<string, unknown> = {}) {
  return {
    id: contractId,
    created_by: 'user-1',
    status: 'DRAFT',
    storage_path: null,
    filename: null,
    size: null,
    mime_type: null,
    updated_at: '2026-07-17T10:00:00.000Z',
    ...overrides,
  }
}

describe('POST /api/contracts/[id]/merge-chunks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireAuth).mockResolvedValue({ id: 'user-1' } as never)
    vi.mocked(inspectContractSource).mockReturnValue({
      ok: true,
      format: 'pdf',
      mimeType: 'application/pdf',
    } as never)
    vi.mocked(extractPdfText).mockResolvedValue('PDF source text')
  })

  it('returns the committed upload idempotently without downloading chunks or uploading the final object again', async () => {
    const { finalBucket, tempBucket } = makeBuckets()
    finalBucket.download.mockResolvedValue({
      data: new Blob([sourceBytes]),
      error: null,
    })
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(initialContractQuery(baseContract({
      storage_path: finalPath,
      filename: fileName,
      size: sourceBytes.byteLength,
      mime_type: 'application/pdf',
    })) as never)

    const response = await POST(request(), context)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      data: {
        storagePath: finalPath,
        fileName,
        fileSize: sourceBytes.byteLength,
      },
    })
    expect(finalBucket.download).toHaveBeenCalledOnce()
    expect(finalBucket.download).toHaveBeenCalledWith(finalPath)
    expect(tempBucket.download).not.toHaveBeenCalled()
    expect(finalBucket.upload).not.toHaveBeenCalled()
    expect(tempBucket.remove).toHaveBeenCalledWith([chunkPath])
    expect(inspectContractSource).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('removes this upload object and returns 409 when CAS loses to another storage path', async () => {
    const { finalBucket, tempBucket } = makeBuckets()
    tempBucket.download.mockImplementation(async (path: string) => {
      if (path === markerPath) return { data: null, error: { message: 'not found' } }
      if (path === chunkPath) return { data: new Blob([sourceBytes]), error: null }
      throw new Error(`unexpected temp download ${path}`)
    })
    finalBucket.upload.mockResolvedValue({ error: null })

    const initialQuery = initialContractQuery(baseContract())
    const updateQuery = updateContractQuery({ data: null, error: null })
    const latestQuery = latestContractQuery({
      data: {
        storage_path: `${contractId}/other-upload.pdf`,
        filename: 'other-upload.pdf',
        size: 7,
        mime_type: 'application/pdf',
      },
      error: null,
    })
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(initialQuery as never)
      .mockReturnValueOnce(updateQuery as never)
      .mockReturnValueOnce(latestQuery as never)

    const response = await POST(request(), context)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toBe('源文件已被另一上传更新，请刷新后重试')
    expect(finalBucket.upload).toHaveBeenCalledWith(
      finalPath,
      expect.any(Uint8Array),
      expect.objectContaining({ contentType: 'application/pdf', upsert: false })
    )
    expect(updateQuery.eq).toHaveBeenCalledWith('updated_at', '2026-07-17T10:00:00.000Z')
    expect(updateQuery.is).toHaveBeenCalledWith('storage_path', null)
    expect(finalBucket.remove).toHaveBeenCalledOnce()
    expect(finalBucket.remove).toHaveBeenCalledWith([finalPath])
    expect(tempBucket.remove).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ phase: 'update_contract' }),
    }))
  })

  it('preserves the final object when CAS outcome cannot be confirmed after a read failure', async () => {
    const { finalBucket, tempBucket } = makeBuckets()
    tempBucket.download.mockImplementation(async (path: string) => {
      if (path === markerPath) return { data: null, error: { message: 'not found' } }
      if (path === chunkPath) return { data: new Blob([sourceBytes]), error: null }
      throw new Error(`unexpected temp download ${path}`)
    })
    finalBucket.upload.mockResolvedValue({ error: null })

    const initialQuery = initialContractQuery(baseContract())
    const updateQuery = updateContractQuery({ data: null, error: { code: 'ECONNRESET', message: 'response lost' } })
    const latestQuery = latestContractQuery({
      data: null,
      error: { code: 'PGRST500', message: 'read unavailable' },
    })
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(initialQuery as never)
      .mockReturnValueOnce(updateQuery as never)
      .mockReturnValueOnce(latestQuery as never)

    const response = await POST(request(), context)

    expect(response.status).toBe(500)
    expect((await response.json()).error).toBe('无法确认源文件提交状态，请重试完成步骤')
    expect(finalBucket.remove).not.toHaveBeenCalled()
    expect(tempBucket.remove).not.toHaveBeenCalled()
    expect(logError).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({ phase: 'confirm_contract_after_cas' }),
    }))
  })

  it('returns 409 on an existing cancellation marker before chunk, final-object, or database writes', async () => {
    const { finalBucket, tempBucket } = makeBuckets()
    tempBucket.download.mockImplementation(async (path: string) => {
      if (path === markerPath) return { data: new Blob(['cancelled']), error: null }
      throw new Error(`unexpected temp download ${path}`)
    })
    const initialQuery = initialContractQuery(baseContract())
    vi.mocked(supabaseAdmin.from).mockReturnValueOnce(initialQuery as never)

    const response = await POST(request(), context)
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.error).toBe('上传会话已取消')
    expect(tempBucket.download).toHaveBeenCalledOnce()
    expect(tempBucket.download).toHaveBeenCalledWith(markerPath)
    expect(finalBucket.upload).not.toHaveBeenCalled()
    expect(finalBucket.remove).not.toHaveBeenCalled()
    expect(tempBucket.remove).not.toHaveBeenCalled()
    expect(inspectContractSource).not.toHaveBeenCalled()
    expect(extractPdfText).not.toHaveBeenCalled()
    expect(supabaseAdmin.from).toHaveBeenCalledTimes(1)
  })

  it('does not delete a committed source when a concurrent cancel marker appears after final upload', async () => {
    const { finalBucket, tempBucket } = makeBuckets()
    let markerChecks = 0
    tempBucket.download.mockImplementation(async (path: string) => {
      if (path === markerPath) {
        markerChecks += 1
        return markerChecks === 1
          ? { data: null, error: { message: 'not found' } }
          : { data: new Blob(['cancelled']), error: null }
      }
      if (path === chunkPath) return { data: new Blob([sourceBytes]), error: null }
      throw new Error(`unexpected temp download ${path}`)
    })
    finalBucket.upload.mockResolvedValue({ error: null })
    finalBucket.download.mockResolvedValue({ data: new Blob([sourceBytes]), error: null })

    const initialQuery = initialContractQuery(baseContract())
    const latestQuery = latestContractQuery({
      data: {
        storage_path: finalPath,
        filename: fileName,
        size: sourceBytes.byteLength,
        mime_type: 'application/pdf',
      },
      error: null,
    })
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(initialQuery as never)
      .mockReturnValueOnce(latestQuery as never)

    const response = await POST(request(), context)

    expect(response.status).toBe(200)
    expect(markerChecks).toBe(2)
    expect(finalBucket.remove).not.toHaveBeenCalled()
    expect(finalBucket.download).toHaveBeenCalledWith(finalPath)
    expect(tempBucket.remove).toHaveBeenCalledWith([chunkPath])
  })

  it('persists the deterministic current DOCX body text with the same uploaded bytes', async () => {
    const docxName = 'source.docx'
    const docxBytes = Buffer.from('PK\u0003\u0004-controlled-docx')
    const docxHash = createHash('sha256').update(docxBytes).digest('hex')
    const docxFinalPath = `${contractId}/${uploadId}_${docxName}`
    const { finalBucket, tempBucket } = makeBuckets()
    tempBucket.download.mockImplementation(async (path: string) => {
      if (path === markerPath) return { data: null, error: { message: 'not found' } }
      if (path === chunkPath) return { data: new Blob([docxBytes]), error: null }
      throw new Error(`unexpected temp download ${path}`)
    })
    finalBucket.upload.mockResolvedValue({ error: null })
    vi.mocked(inspectContractSource).mockReturnValue({
      ok: true,
      format: 'docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    } as never)
    vi.mocked(extractCurrentWordText).mockResolvedValue('系统服务合同\n付款期限为 30 天')

    const initialQuery = initialContractQuery(baseContract())
    const updateQuery = updateContractQuery({ data: { id: contractId }, error: null })
    vi.mocked(supabaseAdmin.from)
      .mockReturnValueOnce(initialQuery as never)
      .mockReturnValueOnce(updateQuery as never)

    const response = await POST(new NextRequest(`http://localhost/api/contracts/${contractId}/merge-chunks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fileName: docxName,
        fileType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        totalSize: docxBytes.byteLength,
        chunkCount: 1,
        uploadId,
        expectedSha256: docxHash,
      }),
    }), context)

    expect(response.status).toBe(200)
    expect(extractCurrentWordText).toHaveBeenCalledWith(expect.any(Uint8Array), 'docx')
    expect(extractPdfText).not.toHaveBeenCalled()
    expect(finalBucket.upload).toHaveBeenCalledWith(
      docxFinalPath,
      expect.any(Uint8Array),
      expect.objectContaining({
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        upsert: false,
      })
    )
    expect(updateQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      filename: docxName,
      storage_path: docxFinalPath,
      parsed_text: '系统服务合同\n付款期限为 30 天',
    }))
    expect(tempBucket.remove).toHaveBeenCalledWith([chunkPath])
  })
})
