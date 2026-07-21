import { NextRequest } from 'next/server'
import { z } from 'zod'
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
  stableSourceUploadId,
  validateUploadSize,
} from '@/lib/documents/chunk-upload-protocol'
import {
  finalizeContractSourceUpload,
  SourceFinalizationError,
  type SourceContractSnapshot,
} from '@/lib/documents/source-ingestion'
import { SourcePreparationError, prepareContractSource } from '@/lib/documents/source-page-map'

function isFile(value: unknown): value is File {
  return typeof File !== 'undefined' && value instanceof File
}

const uploadFormSchema = z.object({
  file: z.custom<File>(isFile),
  purpose: z.enum(['source', 'manual_revision', 'customer-return']).optional(),
})

function authError(error: unknown) {
  return error instanceof Error && error.name === 'AuthError'
    ? errorResponse(createApiError('UNAUTHORIZED'))
    : null
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
    const parsed = uploadFormSchema.safeParse({
      file: formData.get('file'),
      purpose: formData.get('purpose') || undefined,
    })
    if (!parsed.success) {
      return errorResponse(createApiError('MISSING_FIELD', '未提供文件'))
    }
    const { file } = parsed.data
    const sizeValidation = validateUploadSize(file.size)
    if (!sizeValidation.ok) {
      return errorResponse(createApiError('VALIDATION_ERROR', sizeValidation.error))
    }
    const bytes = new Uint8Array(await file.arrayBuffer())

    // Parse and signature-check before organization/database/storage work. The
    // exact bytes are reused later; no second, divergent extraction occurs.
    const preparation = await prepareContractSource(bytes, file.name, file.type)
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
      .select('id, org_id, status, storage_path, filename, size, mime_type, updated_at')
      .eq('id', contractId)
      .eq('org_id', orgId)
      .in('created_by', accessibleUserIds)
      .maybeSingle()
    if (fetchError || !contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在或无权访问'))
    }

    const finalized = await finalizeContractSourceUpload({
      contract: contract as SourceContractSnapshot,
      orgId,
      userId: user.id,
      fileName: file.name,
      fileType: preparation.mimeType,
      bytes,
      uploadId: await stableSourceUploadId(contractId, preparation.sourceHash),
      preparation,
    })
    return successResponse({
      ...finalized,
      fileUrl: `/api/contracts/${contractId}/file?path=${encodeURIComponent(finalized.storagePath)}`,
      uploadPurpose: parsed.data.purpose || 'source',
      contractUpdated: true,
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
      context: { route: '/api/contracts/[id]/upload' },
    })
    return errorResponse(createApiError('INTERNAL_ERROR'))
  }
}
