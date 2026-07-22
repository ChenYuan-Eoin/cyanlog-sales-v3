export const CONTRACT_UPLOAD_MAX_BYTES = 50 * 1024 * 1024
export const CONTRACT_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024

const MAX_FILE_NAME_CHARS = 255
const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/i

export interface ChunkUploadMetadata {
  index: number
  start: number
  end: number
  totalSize: number
  chunkSize: number
  fileName: string
  uploadId: string
  expectedSha256: string
}

export interface MergeUploadMetadata {
  totalSize: number
  chunkCount: number
  fileName: string
  uploadId: string
  expectedSha256: string
}

export interface UploadCleanupMetadata {
  uploadId: string
  chunkCount: number
}

export type UploadProtocolValidation =
  | { ok: true }
  | { ok: false; error: string }

function isSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value)
}

function validateFileName(fileName: string): UploadProtocolValidation {
  if (
    typeof fileName !== 'string'
    || fileName.length < 1
    || fileName.length > MAX_FILE_NAME_CHARS
    || fileName.includes('\0')
    || /[\\/]/.test(fileName)
  ) {
    return { ok: false, error: '文件名无效' }
  }

  return { ok: true }
}

function validateUploadIdentity(
  uploadId: string,
  expectedSha256: string
): UploadProtocolValidation {
  if (typeof uploadId !== 'string' || !UPLOAD_ID_PATTERN.test(uploadId)) {
    return { ok: false, error: '上传会话无效' }
  }
  if (typeof expectedSha256 !== 'string' || !SHA256_PATTERN.test(expectedSha256)) {
    return { ok: false, error: '文件摘要无效' }
  }
  return { ok: true }
}

export function expectedChunkCount(totalSize: number): number {
  return Math.ceil(totalSize / CONTRACT_UPLOAD_CHUNK_BYTES)
}

export function validateUploadSize(totalSize: number): UploadProtocolValidation {
  if (
    !isSafeInteger(totalSize)
    || totalSize < 1
    || totalSize > CONTRACT_UPLOAD_MAX_BYTES
  ) {
    return { ok: false, error: '文件大小无效或超过 50MB 限制' }
  }

  return { ok: true }
}

export function expectedChunkBounds(index: number, totalSize: number) {
  const start = index * CONTRACT_UPLOAD_CHUNK_BYTES
  return {
    start,
    end: Math.min(start + CONTRACT_UPLOAD_CHUNK_BYTES, totalSize),
  }
}

export function validateChunkUpload(
  metadata: ChunkUploadMetadata
): UploadProtocolValidation {
  const fileNameValidation = validateFileName(metadata.fileName)
  if (!fileNameValidation.ok) return fileNameValidation
  const identityValidation = validateUploadIdentity(
    metadata.uploadId,
    metadata.expectedSha256
  )
  if (!identityValidation.ok) return identityValidation

  const sizeValidation = validateUploadSize(metadata.totalSize)
  if (!sizeValidation.ok) return sizeValidation

  const chunkCount = expectedChunkCount(metadata.totalSize)
  if (
    !isSafeInteger(metadata.index)
    || metadata.index < 0
    || metadata.index >= chunkCount
  ) {
    return { ok: false, error: '分块序号无效' }
  }

  if (
    !isSafeInteger(metadata.start)
    || !isSafeInteger(metadata.end)
    || !isSafeInteger(metadata.chunkSize)
  ) {
    return { ok: false, error: '分块边界无效' }
  }

  const expected = expectedChunkBounds(metadata.index, metadata.totalSize)
  if (
    metadata.start !== expected.start
    || metadata.end !== expected.end
    || metadata.chunkSize !== expected.end - expected.start
  ) {
    return { ok: false, error: '分块边界或大小与上传协议不一致' }
  }

  return { ok: true }
}

export function validateMergeUpload(
  metadata: MergeUploadMetadata
): UploadProtocolValidation {
  const fileNameValidation = validateFileName(metadata.fileName)
  if (!fileNameValidation.ok) return fileNameValidation
  const identityValidation = validateUploadIdentity(
    metadata.uploadId,
    metadata.expectedSha256
  )
  if (!identityValidation.ok) return identityValidation

  const sizeValidation = validateUploadSize(metadata.totalSize)
  if (!sizeValidation.ok) return sizeValidation

  if (
    !isSafeInteger(metadata.chunkCount)
    || metadata.chunkCount !== expectedChunkCount(metadata.totalSize)
  ) {
    return { ok: false, error: '分块数量与文件大小不一致' }
  }

  return { ok: true }
}

export function validateUploadCleanup(
  metadata: UploadCleanupMetadata
): UploadProtocolValidation {
  if (typeof metadata.uploadId !== 'string' || !UPLOAD_ID_PATTERN.test(metadata.uploadId)) {
    return { ok: false, error: '上传会话无效' }
  }
  if (
    !isSafeInteger(metadata.chunkCount)
    || metadata.chunkCount < 1
    || metadata.chunkCount > expectedChunkCount(CONTRACT_UPLOAD_MAX_BYTES)
  ) {
    return { ok: false, error: '分块数量无效' }
  }
  return { ok: true }
}

export function chunkObjectPath(
  contractId: string,
  uploadId: string,
  index: number
): string {
  return `${contractId}/${uploadId}/${index}.part`
}

export function uploadCancellationPath(contractId: string, uploadId: string): string {
  return `${contractId}/${uploadId}/cancelled.marker`
}
