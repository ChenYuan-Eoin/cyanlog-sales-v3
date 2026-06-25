// POST /api/contracts/[id]/upload - 上传合同文件
// REQ: F005

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { logError } from '@/lib/error-log'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'
import { errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { extractContractText } from '@/lib/contracts/text-extraction'

const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/jpg',
]
const ALLOWED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.jpg', '.jpeg', '.png']

const MAX_SIZE = 50 * 1024 * 1024 // 50MB

function hasAllowedFileType(file: File): boolean {
  const extension = `.${file.name.split('.').pop()?.toLowerCase() || ''}`
  return ALLOWED_TYPES.includes(file.type) || ALLOWED_EXTENSIONS.includes(extension)
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth(req)
    if (!user) {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }

    const orgId = await getDefaultOrgId(user.id)
    const { userIds: accessibleUserIds } = await listAccessibleUserIds(user.id, orgId)
    const contractId = params.id

    // 获取表单数据
    const formData = await req.formData()
    const file = formData.get('file') as File

    if (!file) {
      return errorResponse(createApiError('MISSING_FIELD', '未提供文件'))
    }

    // 验证文件类型
    if (!hasAllowedFileType(file)) {
      return errorResponse(createApiError('VALIDATION_ERROR', '不支持的文件类型，请上传 PDF、Word 或图片'))
    }

    // 验证文件大小
    if (file.size > MAX_SIZE) {
      return errorResponse(createApiError('VALIDATION_ERROR', '文件大小超过 50MB 限制'))
    }

    // 检查合同是否存在且有权限
    const { data: contract, error: fetchError } = await supabaseAdmin
      .from('contracts')
      .select('id, created_by, org_id, status')
      .eq('id', contractId)
      .eq('org_id', orgId)
      .in('created_by', accessibleUserIds)
      .single()

    if (fetchError || !contract) {
      return errorResponse(createApiError('NOT_FOUND', '合同不存在'))
    }

    // 生成存储路径：contracts/{contractId}/{timestamp}_{filename}
    const timestamp = Date.now()
    const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const storagePath = `${contractId}/${timestamp}_${safeFileName}`
    const fileBytes = Buffer.from(await file.arrayBuffer())
    const parsedText = extractContractText(fileBytes, file.name, file.type)

    // 上传文件到 Supabase Storage
    const { error: uploadError } = await supabaseAdmin
      .storage
      .from('contracts')
      .upload(storagePath, fileBytes, {
        contentType: file.type,
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
          route: '/api/contracts/[id]/upload',
          contractId,
          fileName: file.name,
        },
      })
      return errorResponse(createApiError('DB_ERROR', '上传失败'))
    }

    // 获取文件 URL
    const { data: urlData } = supabaseAdmin
      .storage
      .from('contracts')
      .getPublicUrl(storagePath)

    // 更新合同记录
    const { error: updateError } = await supabaseAdmin
      .from('contracts')
      .update({
        filename: file.name,
        storage_path: storagePath,
        size: file.size,
        mime_type: file.type || 'application/octet-stream',
        ...(parsedText
          ? {
              parsed_text: parsedText,
              ocr_status: 'COMPLETED',
              ocr_result: {
                raw_text: parsedText,
                confidence: 0.8,
                source: 'text-extraction',
                completed_at: new Date().toISOString(),
              },
            }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', contractId)
      .eq('org_id', orgId)

    if (updateError) {
      await logError({
        req,
        source: 'api',
        userId: user.id,
        message: updateError.message,
        error: updateError,
        context: {
          route: '/api/contracts/[id]/upload',
          contractId,
          phase: 'update_contract',
        },
      })
    }

    return NextResponse.json({
      success: true,
      data: {
        fileUrl: urlData.publicUrl,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        storagePath,
      },
      message: '上传成功',
    })
  } catch (error: unknown) {
    const err = error as Error
    await logError({
      req,
      source: 'api',
      message: err.message,
      error,
      context: {
        route: '/api/contracts/[id]/upload',
      },
    })
    return errorResponse(createApiError('INTERNAL_ERROR', '服务器错误'))
  }
}
