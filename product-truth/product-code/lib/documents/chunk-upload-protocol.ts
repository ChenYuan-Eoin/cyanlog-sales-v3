export const CONTRACT_UPLOAD_MAX_BYTES = 50 * 1024 * 1024
export const CONTRACT_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024

const MAX_FILE_NAME_CHARS = 255
const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256_PATTERN = /^[0-9a-f]{64}$/i

function formatUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * Derive the upload transaction identity from the immutable business object
 * (contract) and exact file bytes (SHA-256). UUIDv8 marks this as an
 * application-defined deterministic UUID instead of a random browser session.
 */
export async function stableSourceUploadId(
  contractId: string,
  expectedSha256: string,
): Promise<string> {
  if (typeof contractId !== 'string' || !UPLOAD_ID_PATTERN.test(contractId)) {
    throw new Error('合同身份无效')
  }
  if (typeof expectedSha256 !== 'string' || !SHA256_PATTERN.test(expectedSha256)) {
    throw new Error('文件摘要无效')
  }

  const material = new TextEncoder().encode(
    `contract-source:${contractId.toLowerCase()}:${expectedSha256.toLowerCase()}`,
  )
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', material))
  const uuidBytes = digest.slice(0, 16)
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | 0x80
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | 0x80
  return formatUuid(uuidBytes)
}

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
  expectedSha256: string
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

/**
 * A browser-provided UUID is not an upload identity by itself. The server must
 * recompute the application-defined UUID from the contract and exact file
 * digest before accepting a chunk or finalizing a source version.
 */
export async function validateStableSourceUploadIdentity(
  contractId: string,
  uploadId: string,
  expectedSha256: string,
): Promise<UploadProtocolValidation> {
  const identityValidation = validateUploadIdentity(uploadId, expectedSha256)
  if (!identityValidation.ok) return identityValidation

  try {
    const expectedUploadId = await stableSourceUploadId(contractId, expectedSha256)
    if (uploadId !== expectedUploadId) {
      return { ok: false, error: '上传会话与合同及文件摘要不一致' }
    }
  } catch {
    return { ok: false, error: '合同身份或文件摘要无效' }
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
  const identityValidation = validateUploadIdentity(
    metadata.uploadId,
    metadata.expectedSha256,
  )
  if (!identityValidation.ok) return identityValidation
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
