// POST /api/contracts/[id]/upload-chunk - 上传单个分块
// 支持大文件分块上传、断点续传

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { logError } from '@/lib/error-log'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'
import { errorResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'

// 临时分块存储桶名称
const TEMP_BUCKET = 'contract-chunks'

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

    // 获取表单数据
    const formData = await req.formData()
    const chunk = formData.get('chunk') as Blob
    const index = parseInt(formData.get('index') as string, 10)
    const start = parseInt(formData.get('start') as string, 10)
    const end = parseInt(formData.get('end') as string, 10)
    const totalSize = parseInt(formData.get('totalSize') as string, 10)
    const fileName = formData.get('fileName') as string
    const fileType = formData.get('fileType') as string

    void totalSize
    void start
    void end

    if (!chunk || isNaN(index)) {
      return errorResponse(createApiError('VALIDATION_ERROR', '无效的分块数据'))
    }

    // 生成临时分块路径
    const tempPath = `${contractId}/${fileName}.part${index}`

    // 上传分块到临时存储
    const { error: uploadError } = await supabaseAdmin
      .storage
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
          chunkIndex: index,
          fileName,
        },
      })
      return errorResponse(createApiError('DB_ERROR', '分块上传失败'))
    }

    return NextResponse.json({
      success: true,
      data: {
        index,
        start,
        end,
        size: chunk.size,
      },
    })
  } catch (error: unknown) {
    const err = error as Error
    await logError({
      req,
      source: 'api',
      message: err.message,
      error,
      context: {
        route: '/api/contracts/[id]/upload-chunk',
      },
    })
    return errorResponse(createApiError('INTERNAL_ERROR', '服务器错误'))
  }
}
