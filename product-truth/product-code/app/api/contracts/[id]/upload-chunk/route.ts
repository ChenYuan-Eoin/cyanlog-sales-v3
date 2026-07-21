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
  uploadCancellationPath,
  validateChunkUpload,
  validateUploadCleanup,
  validateStableSourceUploadIdentity,
} from '@/lib/documents/chunk-upload-protocol'
import { inspectContractSource } from '@/lib/documents/source-format'

const TEMP_BUCKET = 'contract-chunks'

function authError(error: unknown) {
  return error instanceof Error && error.name === 'AuthError'
    ? errorResponse(createApiError('UNAUTHORIZED'))
    : null
}

function supportedContractSource(fileName: string, fileType: string) {
  const inspection = inspectContractSource(fileName, fileType)
  return inspection.ok
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth(req)
    const { id: contractId } = await params
    const formData = await req.formData().catch(() => null)
    if (!formData) {
      return errorResponse(createApiError('VALIDATION_ERROR', '请求格式不是有效的表单数据'))
    }

    const chunkValue = formData.get('chunk')
    const chunk = chunkValue instanceof Blob ? chunkValue : null
    const fileNameValue = formData.get('fileName')
    const fileName = typeof fileNameValue === 'string' ? fileNameValue : ''
    const fileTypeValue = formData.get('fileType')
    const fileType = typeof fileTypeValue === 'string' ? fileTypeValue : ''
    const uploadIdValue = formData.get('uploadId')
    const uploadId = typeof uploadIdValue === 'string' ? uploadIdValue : ''
    const expectedSha256Value = formData.get('expectedSha256')
    const expectedSha256 = typeof expectedSha256Value === 'string'
      ? expectedSha256Value
      : ''

    if (!chunk) {
      return errorResponse(createApiError('VALIDATION_ERROR', '无效的分块数据'))
    }
    const validation = validateChunkUpload({
      index: Number(formData.get('index')),
      start: Number(formData.get('start')),
      end: Number(formData.get('end')),
      totalSize: Number(formData.get('totalSize')),
      chunkSize: chunk.size,
      fileName,
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
    if (!supportedContractSource(fileName, fileType)) {
      return errorResponse(createApiError(
        'VALIDATION_ERROR',
        '仅支持 PDF、DOC、DOCX、DOCM',
      ))
    }

    const {
      orgId,
      assignments,
      userIds: accessibleUserIds,
    } = await listFreshAccessibleUserIds(user.id)
    if (!canAccessContractAction(assignments, orgId, 'create_or_upload')) {
      return errorResponse(createApiError('FORBIDDEN', '没有上传合同源文件的权限'))
    }
    const { data: contract, error: fetchError } = await supabaseAdmin
      .from('contracts')
      .select('id, status')
      .eq('id', contractId)
      .eq('org_id', orgId)
      .in('created_by', accessibleUserIds)
      .maybeSingle()

    if (fetchError || !contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在或无权访问'))
    }
    if (contract.status === 'PARSING' || contract.status === 'ANALYZING') {
      return errorResponse(createApiError('CONFLICT', '合同正在审核或复审，源文件已锁定'))
    }

    const index = Number(formData.get('index'))
    const tempPath = chunkObjectPath(contractId, uploadId, index)
    const { error: uploadError } = await supabaseAdmin.storage
      .from(TEMP_BUCKET)
      .upload(tempPath, chunk, {
        contentType: fileType || 'application/octet-stream',
        upsert: true,
      })

    if (uploadError) {
      await logError({
        req,
        source: 'api',
        userId: user.id,
        message: uploadError.message,
        error: uploadError,
        context: {
          route: '/api/contracts/[id]/upload-chunk',
          contractId,
          uploadId,
          chunkIndex: index,
          fileName,
        },
      })
      return errorResponse(createApiError('DB_ERROR', '分块上传失败'))
    }

    return successResponse({
      uploadId,
      expectedSha256,
      index,
      start: Number(formData.get('start')),
      end: Number(formData.get('end')),
      size: chunk.size,
    })
  } catch (error) {
    const response = authError(error)
    if (response) return response
    await logError({
      req,
      source: 'api',
      message: error instanceof Error ? error.message : String(error),
      error,
      context: { route: '/api/contracts/[id]/upload-chunk' },
    })
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth(req)
    const { id: contractId } = await params
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return errorResponse(createApiError('INVALID_JSON'))
    }
    const uploadId = (body as { uploadId?: unknown }).uploadId
    const expectedSha256 = (body as { expectedSha256?: unknown }).expectedSha256
    const chunkCount = (body as { chunkCount?: unknown }).chunkCount
    const validation = validateUploadCleanup({
      uploadId: typeof uploadId === 'string' ? uploadId : '',
      expectedSha256: typeof expectedSha256 === 'string' ? expectedSha256 : '',
      chunkCount: Number(chunkCount),
    })
    if (!validation.ok) {
      return errorResponse(createApiError('VALIDATION_ERROR', validation.error))
    }
    const stableIdentity = await validateStableSourceUploadIdentity(
      contractId,
      uploadId as string,
      expectedSha256 as string,
    )
    if (!stableIdentity.ok) {
      return errorResponse(createApiError('VALIDATION_ERROR', stableIdentity.error))
    }

    const {
      orgId,
      assignments,
      userIds: accessibleUserIds,
    } = await listFreshAccessibleUserIds(user.id)
    if (!canAccessContractAction(assignments, orgId, 'create_or_upload')) {
      return errorResponse(createApiError('FORBIDDEN', '没有取消合同上传的权限'))
    }
    const { data: contract, error: fetchError } = await supabaseAdmin
      .from('contracts')
      .select('id, updated_at, storage_path')
      .eq('id', contractId)
      .eq('org_id', orgId)
      .in('created_by', accessibleUserIds)
      .maybeSingle()

    if (fetchError || !contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在或无权访问'))
    }
    if (
      typeof contract.storage_path === 'string'
      && contract.storage_path.startsWith(`${contractId}/${uploadId}/`)
    ) {
      return errorResponse(createApiError('CONFLICT', '上传会话已经提交，不能再取消'))
    }

    const markerPath = uploadCancellationPath(contractId, uploadId as string)
    const { error: markerError } = await supabaseAdmin.storage
      .from(TEMP_BUCKET)
      .upload(markerPath, new Uint8Array([1]), {
        contentType: 'application/x-price-upload-cancelled',
        upsert: true,
      })
    if (markerError) {
      return errorResponse(createApiError('DB_ERROR', '无法标记上传会话为已取消'))
    }

    const { data: fencedContract, error: fenceError } = await supabaseAdmin
      .from('contracts')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', contractId)
      .eq('org_id', orgId)
      .eq('updated_at', contract.updated_at)
      .select('id')
      .maybeSingle()
    if (fenceError || !fencedContract) {
      // The cancellation marker was created before the CAS. If another
      // request committed first, remove our uncommitted marker so the stable
      // contract+SHA upload identity is not poisoned for every later retry.
      await supabaseAdmin.storage.from(TEMP_BUCKET).remove([markerPath])
      return errorResponse(createApiError('CONFLICT', '上传已提交或合同状态已变化'))
    }

    const paths = Array.from(
      { length: Number(chunkCount) },
      (_, index) => chunkObjectPath(contractId, uploadId as string, index),
    )
    // The CAS fence above invalidates any merge that read the pre-cancel
    // contract snapshot. Remove the marker with the chunks so the same stable
    // contract+SHA upload identity can be started again intentionally.
    const { error: cleanupError } = await supabaseAdmin.storage
      .from(TEMP_BUCKET)
      .remove([...paths, markerPath])
    if (cleanupError) {
      return errorResponse(createApiError('DB_ERROR', '上传已取消，但临时分块清理失败'))
    }

    return successResponse({ uploadId, cancelled: true })
  } catch (error) {
    const response = authError(error)
    if (response) return response
    await logError({
      req,
      source: 'api',
      message: error instanceof Error ? error.message : String(error),
      error,
      context: { route: '/api/contracts/[id]/upload-chunk', method: 'DELETE' },
    })
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}
