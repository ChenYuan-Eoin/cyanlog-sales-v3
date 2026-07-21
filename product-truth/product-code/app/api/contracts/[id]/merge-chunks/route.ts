import { createHash } from 'node:crypto'
import { NextRequest } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { logError } from '@/lib/error-log'
import {
  canAccessContractAction,
  listFreshAccessibleUserIds,
} from '@/lib/scoped-access'
import { supabaseAdmin } from '@/lib/supabase'
import {
  chunkObjectPath,
  expectedChunkBounds,
  uploadCancellationPath,
  validateMergeUpload,
  validateStableSourceUploadIdentity,
} from '@/lib/documents/chunk-upload-protocol'
import { inspectContractSource } from '@/lib/documents/source-format'
import {
  finalizeContractSourceUpload,
  SourceFinalizationError,
  type SourceContractSnapshot,
} from '@/lib/documents/source-ingestion'
import { SourcePreparationError } from '@/lib/documents/source-page-map'

const TEMP_BUCKET = 'contract-chunks'

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function authError(error: unknown) {
  return error instanceof Error && error.name === 'AuthError'
    ? errorResponse(createApiError('UNAUTHORIZED'))
    : null
}

function isMissingObjectError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const record = error as { status?: unknown; statusCode?: unknown; message?: unknown }
  const status = Number(record.statusCode || record.status)
  const message = typeof record.message === 'string' ? record.message.toLowerCase() : ''
  return status === 404 || message.includes('not found') || message.includes('does not exist')
}

async function uploadWasCancelled(contractId: string, uploadId: string) {
  const { data, error } = await supabaseAdmin.storage
    .from(TEMP_BUCKET)
    .download(uploadCancellationPath(contractId, uploadId))
  if (data && !error) return true
  if (!error || isMissingObjectError(error)) return false
  throw new SourceFinalizationError(
    'SOURCE_COMMIT_UNKNOWN',
    '无法确认上传会话是否已取消，请稍后重试',
    500,
  )
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth(req)
    const { id: contractId } = await params
    const body = await req.json().catch(() => null)
    if (!isJsonObject(body)) {
      return errorResponse(createApiError('INVALID_JSON'))
    }
    if (
      typeof body.fileName !== 'string'
      || typeof body.totalSize !== 'number'
      || typeof body.chunkCount !== 'number'
      || typeof body.uploadId !== 'string'
      || typeof body.expectedSha256 !== 'string'
    ) {
      return errorResponse(createApiError('MISSING_FIELD', '缺少上传会话、文件摘要或分块参数'))
    }

    const fileName = typeof body.fileName === 'string' ? body.fileName : ''
    const fileType = typeof body.fileType === 'string' ? body.fileType : ''
    const totalSize = Number(body.totalSize)
    const chunkCount = Number(body.chunkCount)
    const uploadId = typeof body.uploadId === 'string' ? body.uploadId : ''
    const expectedSha256 = typeof body.expectedSha256 === 'string'
      ? body.expectedSha256.toLowerCase()
      : ''
    const validation = validateMergeUpload({
      fileName,
      totalSize,
      chunkCount,
      uploadId,
      expectedSha256,
    })
    if (!validation.ok) {
      return errorResponse(createApiError('VALIDATION_ERROR', validation.error))
    }
    const stableIdentity = await validateStableSourceUploadIdentity(
      contractId,
      uploadId,
      expectedSha256,
    )
    if (!stableIdentity.ok) {
      return errorResponse(createApiError('VALIDATION_ERROR', stableIdentity.error))
    }
    const inspection = inspectContractSource(fileName, fileType)
    if (!inspection.ok) {
      return errorResponse(createApiError(
        'VALIDATION_ERROR',
        inspection.error || '仅支持 PDF、DOC、DOCX、DOCM',
      ))
    }

    const {
      orgId,
      assignments,
      userIds: accessibleUserIds,
    } = await listFreshAccessibleUserIds(user.id)
    if (!canAccessContractAction(assignments, orgId, 'create_or_upload')) {
      return errorResponse(createApiError('FORBIDDEN', '没有提交合同上传的权限'))
    }
    const { data: contract, error: fetchError } = await supabaseAdmin
      .from('contracts')
      .select('id, org_id, status, storage_path, filename, size, mime_type, updated_at')
      .eq('id', contractId)
      .eq('org_id', orgId)
      .in('created_by', accessibleUserIds)
      .maybeSingle()

    if (fetchError || !contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在或无权访问'))
    }
    if (await uploadWasCancelled(contractId, uploadId)) {
      return errorResponse(createApiError('CONFLICT', '上传会话已取消'))
    }

    const tempPaths = Array.from(
      { length: chunkCount },
      (_, index) => chunkObjectPath(contractId, uploadId, index),
    )
    const mergedBytes = new Uint8Array(totalSize)
    let offset = 0
    for (let index = 0; index < chunkCount; index += 1) {
      const { data, error } = await supabaseAdmin.storage
        .from(TEMP_BUCKET)
        .download(tempPaths[index])
      if (error || !data) {
        await logError({
          req,
          source: 'api',
          userId: user.id,
          message: error?.message || `分块 ${index} 不存在`,
          error,
          context: {
            route: '/api/contracts/[id]/merge-chunks',
            contractId,
            uploadId,
            chunkIndex: index,
            phase: 'download_chunk',
          },
        })
        return errorResponse(createApiError('DB_ERROR', `下载分块 ${index} 失败`))
      }

      const chunk = new Uint8Array(await data.arrayBuffer())
      const expected = expectedChunkBounds(index, totalSize)
      if (chunk.byteLength !== expected.end - expected.start) {
        return errorResponse(createApiError(
          'VALIDATION_ERROR',
          `分块 ${index} 大小与上传声明不一致`,
        ))
      }
      mergedBytes.set(chunk, offset)
      offset += chunk.byteLength
    }

    if (offset !== totalSize) {
      return errorResponse(createApiError('VALIDATION_ERROR', '分块合并后的文件大小与上传声明不一致'))
    }
    const actualSha256 = createHash('sha256').update(mergedBytes).digest('hex')
    if (actualSha256 !== expectedSha256) {
      return errorResponse(createApiError('VALIDATION_ERROR', '文件摘要与上传声明不一致'))
    }
    if (await uploadWasCancelled(contractId, uploadId)) {
      return errorResponse(createApiError('CONFLICT', '上传会话已取消'))
    }

    const finalized = await finalizeContractSourceUpload({
      contract: contract as SourceContractSnapshot,
      orgId,
      userId: user.id,
      fileName,
      fileType,
      bytes: mergedBytes,
      uploadId,
    })

    // Temporary chunks are retained across every failure above. They are
    // removed only after storage, CAS, version and source identity converge.
    const { error: cleanupError } = await supabaseAdmin.storage
      .from(TEMP_BUCKET)
      .remove(tempPaths)
    if (cleanupError) {
      await logError({
        req,
        source: 'api',
        userId: user.id,
        message: cleanupError.message,
        error: cleanupError,
        context: {
          route: '/api/contracts/[id]/merge-chunks',
          contractId,
          uploadId,
          phase: 'cleanup_chunks',
        },
      })
    }

    return successResponse({
      ...finalized,
      fileUrl: `/api/contracts/${contractId}/file?path=${encodeURIComponent(finalized.storagePath)}`,
      expectedSha256,
      chunksCleaned: !cleanupError,
    })
  } catch (error) {
    const response = authError(error)
    if (response) return response
    if (error instanceof SourcePreparationError) {
      return errorResponse(createApiError('VALIDATION_ERROR', error.message))
    }
    if (error instanceof SourceFinalizationError) {
      const key = error.status === 409 ? 'CONFLICT' : 'DB_ERROR'
      return errorResponse(createApiError(key, error.message), error.status)
    }
    await logError({
      req,
      source: 'api',
      message: error instanceof Error ? error.message : String(error),
      error,
      context: { route: '/api/contracts/[id]/merge-chunks' },
    })
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}
