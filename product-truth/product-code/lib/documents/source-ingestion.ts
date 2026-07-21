import { createHash } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase'
import {
  prepareContractSource,
  type PreparedContractSource,
} from './source-page-map'
import { stableSourceUploadId } from './chunk-upload-protocol'

const FINAL_BUCKET = 'contracts'

export interface SourceContractSnapshot {
  id: string
  org_id: string
  status: string
  storage_path: string | null
  filename: string | null
  size: number | null
  mime_type: string | null
  updated_at: string
}

export interface FinalizeContractSourceInput {
  contract: SourceContractSnapshot
  orgId: string
  userId: string
  fileName: string
  fileType?: string | null
  bytes: Uint8Array
  uploadId: string
  preparation?: PreparedContractSource
}

export interface FinalizedContractSource {
  contractId: string
  storagePath: string
  fileName: string
  fileSize: number
  fileType: string
  sourceHash: string
  sourceTextHash: string | null
  preparationStatus: PreparedContractSource['status']
  preparationReason: PreparedContractSource['reason']
  reviewReady: boolean
  renderMode: PreparedContractSource['renderMode']
  pageMapLocator: 'provisional' | null
  versionId: string
  versionNumber: number
  versionSource: string
  recovered: boolean
  contractStatus: 'PENDING' | 'DRAFT'
}

export class SourceFinalizationError extends Error {
  constructor(
    readonly code:
      | 'SOURCE_LOCKED'
      | 'SOURCE_STORAGE_FAILED'
      | 'SOURCE_CONFLICT'
      | 'SOURCE_COMMIT_UNKNOWN'
      | 'SOURCE_VERSION_FAILED'
      | 'SOURCE_IDENTITY_FAILED',
    message: string,
    readonly status: 409 | 500,
  ) {
    super(message)
    this.name = 'SourceFinalizationError'
  }
}

export function deterministicSourceStoragePath(
  contractId: string,
  uploadId: string,
  _fileName: string,
) {
  return `${contractId}/${uploadId}/source`
}

async function storedObjectMatches(
  storagePath: string,
  expectedSize: number,
  expectedSha256: string,
) {
  const { data, error } = await supabaseAdmin.storage.from(FINAL_BUCKET).download(storagePath)
  if (error || !data) return false
  const bytes = new Uint8Array(await data.arrayBuffer())
  return bytes.byteLength === expectedSize
    && createHash('sha256').update(bytes).digest('hex') === expectedSha256
}

type FinalIngestStatus = 'SOURCE_READY' | 'AWAITING_OCR' | 'AWAITING_CONVERSION'

interface FinalizeRpcRow {
  contract_version_id: string
  ingest_status: FinalIngestStatus
  version_number: number
  version_source: string
  recovered: boolean
}

interface RecoveredVersionRow {
  id: string
  contract_id: string
  storage_path: string
  file_sha256: string
  ingest_status: FinalIngestStatus
  version_number: number
  source: string
}

interface RecoveredContractRow {
  current_version_id: string | null
  storage_path: string | null
}

const SOURCE_UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function finalIngestStatus(preparation: PreparedContractSource): FinalIngestStatus {
  if (preparation.status === 'READY') return 'SOURCE_READY'
  return preparation.status
}

function finalizedResult(
  input: FinalizeContractSourceInput,
  storagePath: string,
  preparation: PreparedContractSource,
  row: FinalizeRpcRow,
): FinalizedContractSource {
  return {
    contractId: input.contract.id,
    storagePath,
    fileName: input.fileName,
    fileSize: input.bytes.byteLength,
    fileType: preparation.mimeType,
    sourceHash: preparation.sourceHash,
    sourceTextHash: preparation.sourceTextHash,
    preparationStatus: preparation.status,
    preparationReason: preparation.reason,
    reviewReady: preparation.status === 'READY',
    renderMode: preparation.renderMode,
    pageMapLocator: preparation.pageMap?.locator || null,
    versionId: row.contract_version_id,
    versionNumber: row.version_number,
    versionSource: row.version_source,
    recovered: row.recovered,
    contractStatus: preparation.status === 'READY' ? 'PENDING' : 'DRAFT',
  }
}

function parseRpcRow(data: unknown, expectedStatus: FinalIngestStatus): FinalizeRpcRow | null {
  const candidate = Array.isArray(data) ? data[0] : data
  if (!candidate || typeof candidate !== 'object') return null
  const row = candidate as Record<string, unknown>
  if (
    typeof row.contract_version_id !== 'string'
    || row.ingest_status !== expectedStatus
    || !Number.isInteger(row.version_number)
    || Number(row.version_number) < 1
    || typeof row.version_source !== 'string'
    || typeof row.recovered !== 'boolean'
  ) {
    return null
  }
  return row as unknown as FinalizeRpcRow
}

async function recoverFinalization(
  input: FinalizeContractSourceInput,
  storagePath: string,
  preparation: PreparedContractSource,
): Promise<FinalizeRpcRow | null> {
  const expectedStatus = finalIngestStatus(preparation)
  let data: unknown = null
  let error: unknown = null
  try {
    const response = await supabaseAdmin
      .from('contract_versions')
      .select('id, contract_id, storage_path, file_sha256, ingest_status, version_number, source')
      .eq('upload_id', input.uploadId)
      .maybeSingle()
    data = response.data
    error = response.error
  } catch (recoveryError) {
    error = recoveryError
  }

  if (error) {
    throw new SourceFinalizationError(
      'SOURCE_COMMIT_UNKNOWN',
      '源文件已保存，但无法确认原子提交结果；请使用同一文件重试',
      500,
    )
  }
  if (!data) return null

  const version = data as RecoveredVersionRow
  if (
    version.contract_id !== input.contract.id
    || version.storage_path !== storagePath
    || version.file_sha256 !== preparation.sourceHash
    || version.ingest_status !== expectedStatus
  ) {
    throw new SourceFinalizationError(
      'SOURCE_CONFLICT',
      '上传标识已绑定到不同的源文件结果，正式文件已保留待核验',
      409,
    )
  }

  let currentContract: RecoveredContractRow | null = null
  let contractError: unknown = null
  try {
    const response = await supabaseAdmin
      .from('contracts')
      .select('current_version_id, storage_path')
      .eq('id', input.contract.id)
      .eq('org_id', input.orgId)
      .maybeSingle()
    currentContract = response.data as RecoveredContractRow | null
    contractError = response.error
  } catch (recoveryError) {
    contractError = recoveryError
  }
  if (contractError || !currentContract) {
    throw new SourceFinalizationError(
      'SOURCE_COMMIT_UNKNOWN',
      '源文件已保存，但无法确认当前合同版本；请使用同一文件重试',
      500,
    )
  }
  if (
    currentContract.current_version_id !== version.id
    || currentContract.storage_path !== storagePath
  ) {
    throw new SourceFinalizationError(
      'SOURCE_CONFLICT',
      '同一上传已存在，但它不再是合同当前源版本；请刷新后核对',
      409,
    )
  }
  if (
    typeof version.id !== 'string'
    || !Number.isInteger(version.version_number)
    || version.version_number < 1
    || typeof version.source !== 'string'
  ) {
    throw new SourceFinalizationError(
      'SOURCE_COMMIT_UNKNOWN',
      '源文件已保存，但版本结果不完整；请使用同一文件重试',
      500,
    )
  }

  return {
    contract_version_id: version.id,
    ingest_status: version.ingest_status,
    version_number: version.version_number,
    version_source: version.source,
    recovered: true,
  }
}

function rpcErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function throwRpcFailure(error: unknown): never {
  const code = rpcErrorCode(error)
  if (code === '55000') {
    throw new SourceFinalizationError('SOURCE_LOCKED', '合同正在审核或复审，源文件已锁定', 409)
  }
  if (code === '40001' || code === '23505' || code === 'P0002') {
    throw new SourceFinalizationError(
      'SOURCE_CONFLICT',
      '合同源文件已发生变化，正式文件已保留；请刷新后重试',
      409,
    )
  }
  if (code === '23514') {
    throw new SourceFinalizationError(
      'SOURCE_IDENTITY_FAILED',
      '源文件已保存，但解析身份不满足原子提交要求',
      500,
    )
  }
  throw new SourceFinalizationError(
    'SOURCE_COMMIT_UNKNOWN',
    '源文件已保存，但原子提交结果未知；请使用同一文件重试',
    500,
  )
}

/**
 * Persist one exact source object, then atomically finalize the contract,
 * version and current page map through the service-role RPC. Once the RPC has
 * been attempted, this function never deletes the formal object: an ambiguous
 * response is recovered only by an exact upload/path/hash/status match.
 */
export async function finalizeContractSourceUpload(
  input: FinalizeContractSourceInput,
): Promise<FinalizedContractSource> {
  if (input.contract.status === 'PARSING' || input.contract.status === 'ANALYZING') {
    throw new SourceFinalizationError(
      'SOURCE_LOCKED',
      '合同正在审核或复审，源文件已锁定',
      409,
    )
  }

  const preparation = input.preparation
    ?? await prepareContractSource(input.bytes, input.fileName, input.fileType)
  if (!SOURCE_UPLOAD_ID_PATTERN.test(input.uploadId)) {
    throw new SourceFinalizationError(
      'SOURCE_IDENTITY_FAILED',
      '上传标识不是合法 UUID',
      500,
    )
  }
  let expectedUploadId: string
  try {
    expectedUploadId = await stableSourceUploadId(input.contract.id, preparation.sourceHash)
  } catch {
    throw new SourceFinalizationError(
      'SOURCE_IDENTITY_FAILED',
      '合同身份或文件摘要无法形成稳定上传标识',
      500,
    )
  }
  if (input.uploadId !== expectedUploadId) {
    throw new SourceFinalizationError(
      'SOURCE_IDENTITY_FAILED',
      '上传标识与合同及源文件摘要不一致',
      500,
    )
  }
  const storagePath = deterministicSourceStoragePath(
    input.contract.id,
    input.uploadId,
    input.fileName,
  )

  const { error: uploadError } = await supabaseAdmin.storage
    .from(FINAL_BUCKET)
    .upload(storagePath, input.bytes, {
      contentType: preparation.mimeType,
      upsert: false,
    })
  if (
    uploadError
    && !await storedObjectMatches(storagePath, input.bytes.byteLength, preparation.sourceHash)
  ) {
    throw new SourceFinalizationError(
      'SOURCE_STORAGE_FAILED',
      '源文件保存失败',
      500,
    )
  }

  const ingestStatus = finalIngestStatus(preparation)
  const ready = preparation.status === 'READY' ? preparation : null
  let rpcData: unknown = null
  let rpcError: unknown = null
  try {
    const response = await supabaseAdmin.rpc(
      'finalize_contract_source_version',
      {
        p_org_id: input.orgId,
        p_contract_id: input.contract.id,
        p_uploaded_by: input.userId,
        p_upload_id: input.uploadId,
        p_expected_updated_at: input.contract.updated_at,
        p_expected_storage_path: input.contract.storage_path,
        p_storage_path: storagePath,
        p_filename: input.fileName,
        p_file_size: input.bytes.byteLength,
        p_mime_type: preparation.mimeType,
        p_file_sha256: preparation.sourceHash,
        p_parsed_text: ready?.parsedText ?? null,
        p_text_sha256: ready?.sourceTextHash ?? null,
        p_ingest_status: ingestStatus,
        p_ingest_error: ready ? null : (preparation.reason || 'PDF_TEXT_UNAVAILABLE'),
        p_render_mode: ready?.renderMode ?? null,
        p_locator: ready?.pageMap.locator ?? null,
        p_page_count: ready?.pageMap.page_count ?? null,
        p_page_map: ready?.pageMap.pages ?? null,
      },
    )
    rpcData = response.data
    rpcError = response.error
  } catch (requestError) {
    rpcError = requestError
  }

  if (!rpcError) {
    const row = parseRpcRow(rpcData, ingestStatus)
    if (row) return finalizedResult(input, storagePath, preparation, row)
  }

  const recovered = await recoverFinalization(input, storagePath, preparation)
  if (recovered) return finalizedResult(input, storagePath, preparation, recovered)
  if (rpcError) throwRpcFailure(rpcError)
  throw new SourceFinalizationError(
    'SOURCE_COMMIT_UNKNOWN',
    '源文件已保存，但原子提交未返回完整结果；请使用同一文件重试',
    500,
  )
}
