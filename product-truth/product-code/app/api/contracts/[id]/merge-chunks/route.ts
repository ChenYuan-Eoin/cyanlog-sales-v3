// POST /api/contracts/[id]/merge-chunks - 合并所有分块
// 将临时分块合并为完整文件，移动到正式存储

import { NextRequest } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { logError } from '@/lib/error-log'
import { getDefaultOrgId, listAccessibleUserIds } from '@/lib/scoped-access'
import { errorResponse, successResponse } from '@/lib/api/common'
import { createApiError } from '@/lib/api/errors'
import { extractContractText } from '@/lib/contracts/text-extraction'

const TEMP_BUCKET = 'contract-chunks'
const FINAL_BUCKET = 'contracts'
const ALLOWED_EXTENSIONS = ['.pdf', '.docx']

const mergeChunksSchema = z.object({
  fileName: z.string().trim().min(1),
  fileType: z.string().optional(),
  totalSize: z.preprocess(
    value => typeof value === 'number' ? value : undefined,
    z.number().nonnegative().optional()
  ),
  chunkCount: z.coerce.number().int().positive(),
})

function hasAllowedFileName(fileName: string): boolean {
  const extension = `.${fileName.split('.').pop()?.toLowerCase() || ''}`
  return ALLOWED_EXTENSIONS.includes(extension)
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req)
    if (!user) {
      return errorResponse(createApiError('UNAUTHORIZED'))
    }

    const { id: contractId } = await params

    // 获取请求参数。无效 JSON 在进入组织/数据库/存储链路前返回 400。
    const body = await req.json().catch(() => null)
    if (!isJsonObject(body)) {
      return errorResponse(createApiError('INVALID_JSON'))
    }

    const parsed = mergeChunksSchema.safeParse(body)
    if (!parsed.success) {
      return errorResponse(createApiError('MISSING_FIELD', '缺少必要参数'))
    }

    const { fileName, fileType, totalSize, chunkCount } = parsed.data
    if (!hasAllowedFileName(fileName)) {
      return errorResponse(createApiError('VALIDATION_ERROR', '不支持的文件类型，请上传 PDF 或 DOCX'))
    }

    const orgId = await getDefaultOrgId(user.id)
    const { userIds: accessibleUserIds } = await listAccessibleUserIds(user.id, orgId)

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

    // 生成正式存储路径
    const timestamp = Date.now()
    const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
    const finalPath = `${contractId}/${timestamp}_${safeFileName}`

    // 按顺序下载并合并所有分块
    const chunks: Uint8Array[] = []

    for (let i = 0; i < chunkCount; i++) {
      const tempPath = `${contractId}/${fileName}.part${i}`

      const { data: chunkData, error: downloadError } = await supabaseAdmin
        .storage
        .from(TEMP_BUCKET)
        .download(tempPath)

      if (downloadError) {
        await logError({
          req,
          source: 'api',
          userId: user.id,
          message: downloadError.message,
          error: downloadError,
          context: {
            route: '/api/contracts/[id]/merge-chunks',
            contractId,
            chunkIndex: i,
            phase: 'download',
          },
        })
        return errorResponse(createApiError('DB_ERROR', `下载分块 ${i} 失败`))
      }

      const arrayBuffer = await chunkData.arrayBuffer()
      chunks.push(new Uint8Array(arrayBuffer))

      // 删除临时分块
      await supabaseAdmin
        .storage
        .from(TEMP_BUCKET)
        .remove([tempPath])
    }

    // 合并所有分块
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
    const mergedArray = new Uint8Array(totalLength)
    let offset = 0

    for (const chunk of chunks) {
      mergedArray.set(chunk, offset)
      offset += chunk.length
    }

    // 上传到正式存储
    const { error: uploadError } = await supabaseAdmin
      .storage
      .from(FINAL_BUCKET)
      .upload(finalPath, mergedArray, {
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
          route: '/api/contracts/[id]/merge-chunks',
          contractId,
          phase: 'upload',
        },
      })
      return errorResponse(createApiError('DB_ERROR', '文件保存失败'))
    }

    // 获取文件 URL
    const { data: urlData } = supabaseAdmin
      .storage
      .from(FINAL_BUCKET)
      .getPublicUrl(finalPath)

    const parsedText = extractContractText(mergedArray, fileName, fileType)
    if (!parsedText) {
      return errorResponse(createApiError('VALIDATION_ERROR', '文件内容无法解析，请上传可复制文本的 PDF 或 DOCX 文件'))
    }

    const { data: latestVersion } = await supabaseAdmin
      .from('contract_versions')
      .select('id, version_number')
      .eq('contract_id', contractId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle()

    const nextVersionNumber = (latestVersion?.version_number || 0) + 1
    const versionSource = latestVersion ? 'manual_revision' : 'original'

    // 更新合同记录
    const { error: updateError } = await supabaseAdmin
      .from('contracts')
      .update({
        filename: fileName,
        storage_path: finalPath,
        size: totalSize,
        mime_type: fileType,
        parsed_text: parsedText,
        ocr_status: 'COMPLETED',
        ocr_result: {
          raw_text: parsedText,
          confidence: 0.8,
          source: 'text-extraction',
          completed_at: new Date().toISOString(),
        },
        status: 'PENDING',
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
          route: '/api/contracts/[id]/merge-chunks',
          contractId,
          phase: 'update_contract',
        },
      })
      return errorResponse(createApiError('DB_ERROR', '合同文件记录更新失败'))
    }

    const { error: versionError } = await supabaseAdmin
      .from('contract_versions')
      .insert({
        contract_id: contractId,
        version_number: nextVersionNumber,
        source: versionSource,
        storage_path: finalPath,
        file_size: totalSize,
        mime_type: fileType || 'application/octet-stream',
        parent_version_id: latestVersion?.id || null,
        change_summary: latestVersion ? '用户分片补充合同文件' : '用户分片上传合同源文件',
        uploaded_by: user.id,
      })

    if (versionError) {
      await logError({
        req,
        source: 'api',
        userId: user.id,
        message: versionError.message,
        error: versionError,
        context: {
          route: '/api/contracts/[id]/merge-chunks',
          contractId,
          phase: 'create_contract_version',
        },
      })
      return errorResponse(createApiError('DB_ERROR', '合同版本记录创建失败'))
    }

    return successResponse({
      contractId,
      fileUrl: urlData.publicUrl,
      storagePath: finalPath,
      fileName,
      fileSize: totalSize,
      fileType,
      versionNumber: nextVersionNumber,
      versionSource,
      status: 'PENDING',
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
        route: '/api/contracts/[id]/merge-chunks',
      },
    })
    return errorResponse(createApiError('INTERNAL_ERROR', '服务器错误'))
  }
}
