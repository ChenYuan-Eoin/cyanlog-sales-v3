import { describe, expect, it } from 'vitest'
import {
  CONTRACT_UPLOAD_CHUNK_BYTES,
  CONTRACT_UPLOAD_MAX_BYTES,
  chunkObjectPath,
  expectedChunkCount,
  stableSourceUploadId,
  uploadCancellationPath,
  validateChunkUpload,
  validateMergeUpload,
  validateStableSourceUploadIdentity,
  validateUploadCleanup,
  validateUploadSize,
} from './chunk-upload-protocol'

const uploadIdentity = {
  uploadId: '019f6d1a-3b21-7cc0-8f4e-123456789abc',
  expectedSha256: 'a'.repeat(64),
}

describe('chunk upload protocol', () => {
  it('derives one stable legal UUID from contract identity and exact file SHA', async () => {
    const contractId = 'd36fe9ff-b22d-4df1-83ae-843b65a1f54c'
    const first = await stableSourceUploadId(contractId, 'a'.repeat(64))
    const retry = await stableSourceUploadId(contractId, 'a'.repeat(64))
    const differentFile = await stableSourceUploadId(contractId, 'b'.repeat(64))

    expect(first).toBe(retry)
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(differentFile).not.toBe(first)
  })

  it('rejects a syntactically valid UUID that is not bound to contract and SHA', async () => {
    const contractId = 'd36fe9ff-b22d-4df1-83ae-843b65a1f54c'
    const expectedSha256 = 'a'.repeat(64)
    const stableId = await stableSourceUploadId(contractId, expectedSha256)

    await expect(validateStableSourceUploadIdentity(
      contractId,
      stableId,
      expectedSha256,
    )).resolves.toEqual({ ok: true })
    await expect(validateStableSourceUploadIdentity(
      contractId,
      '019f6d1a-3b21-7cc0-8f4e-123456789abc',
      expectedSha256,
    )).resolves.toEqual({
      ok: false,
      error: '上传会话与合同及文件摘要不一致',
    })
  })

  it('accepts a complete 4MB chunk and a shorter final chunk', () => {
    const totalSize = CONTRACT_UPLOAD_CHUNK_BYTES + 17

    expect(validateChunkUpload({
      index: 0,
      start: 0,
      end: CONTRACT_UPLOAD_CHUNK_BYTES,
      totalSize,
      chunkSize: CONTRACT_UPLOAD_CHUNK_BYTES,
      fileName: '合同.docx',
      ...uploadIdentity,
    })).toEqual({ ok: true })

    expect(validateChunkUpload({
      index: 1,
      start: CONTRACT_UPLOAD_CHUNK_BYTES,
      end: totalSize,
      totalSize,
      chunkSize: 17,
      fileName: '合同.docx',
      ...uploadIdentity,
    })).toEqual({ ok: true })
  })

  it('rejects oversized files and oversized or forged chunks', () => {
    expect(validateChunkUpload({
      index: 0,
      start: 0,
      end: CONTRACT_UPLOAD_CHUNK_BYTES,
      totalSize: CONTRACT_UPLOAD_MAX_BYTES + 1,
      chunkSize: CONTRACT_UPLOAD_CHUNK_BYTES,
      fileName: 'too-large.pdf',
      ...uploadIdentity,
    }).ok).toBe(false)

    expect(validateChunkUpload({
      index: 0,
      start: 0,
      end: CONTRACT_UPLOAD_CHUNK_BYTES + 1,
      totalSize: CONTRACT_UPLOAD_CHUNK_BYTES + 1,
      chunkSize: CONTRACT_UPLOAD_CHUNK_BYTES + 1,
      fileName: 'forged.pdf',
      ...uploadIdentity,
    })).toEqual({ ok: false, error: '分块边界或大小与上传协议不一致' })
  })

  it('rejects empty files before a contract upload starts', () => {
    expect(validateUploadSize(0)).toEqual({
      ok: false,
      error: '文件大小无效或超过 50MB 限制',
    })
    expect(validateUploadSize(1)).toEqual({ ok: true })
  })

  it('rejects negative, fractional and out-of-range indexes', () => {
    const base = {
      start: 0,
      end: 10,
      totalSize: 10,
      chunkSize: 10,
      fileName: 'contract.docx',
      ...uploadIdentity,
    }

    expect(validateChunkUpload({ ...base, index: -1 }).ok).toBe(false)
    expect(validateChunkUpload({ ...base, index: 0.5 }).ok).toBe(false)
    expect(validateChunkUpload({ ...base, index: 1 }).ok).toBe(false)
  })

  it('requires merge chunk count to match the fixed protocol', () => {
    const totalSize = CONTRACT_UPLOAD_MAX_BYTES
    expect(expectedChunkCount(totalSize)).toBe(13)
    expect(validateMergeUpload({
      totalSize,
      chunkCount: 13,
      fileName: 'large.pdf',
      ...uploadIdentity,
    })).toEqual({ ok: true })
    expect(validateMergeUpload({
      totalSize,
      chunkCount: 12,
      fileName: 'large.pdf',
      ...uploadIdentity,
    }).ok).toBe(false)
  })

  it('rejects path-like names and encodes safe unicode object names', () => {
    expect(validateMergeUpload({
      totalSize: 1,
      chunkCount: 1,
      fileName: '../escape.docx',
      ...uploadIdentity,
    }).ok).toBe(false)
    expect(chunkObjectPath('contract-1', uploadIdentity.uploadId, 0))
      .toBe(`contract-1/${uploadIdentity.uploadId}/0.part`)
    expect(uploadCancellationPath('contract-1', uploadIdentity.uploadId))
      .toBe(`contract-1/${uploadIdentity.uploadId}/cancelled.marker`)
  })

  it('requires a unique upload session and a SHA-256 file identity', () => {
    expect(validateMergeUpload({
      totalSize: 1,
      chunkCount: 1,
      fileName: 'contract.docx',
      uploadId: '../shared',
      expectedSha256: 'a'.repeat(64),
    }).ok).toBe(false)
    expect(validateMergeUpload({
      totalSize: 1,
      chunkCount: 1,
      fileName: 'contract.docx',
      uploadId: uploadIdentity.uploadId,
      expectedSha256: 'not-a-sha',
    }).ok).toBe(false)
  })

  it('bounds cancellation cleanup to one valid upload session', () => {
    expect(validateUploadCleanup({
      uploadId: uploadIdentity.uploadId,
      expectedSha256: uploadIdentity.expectedSha256,
      chunkCount: 13,
    })).toEqual({ ok: true })
    expect(validateUploadCleanup({
      uploadId: uploadIdentity.uploadId,
      expectedSha256: uploadIdentity.expectedSha256,
      chunkCount: 14,
    }).ok).toBe(false)
  })
})
