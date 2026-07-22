// POST /api/contracts/[id]/upload-chunk - 上传单个分块
// 支持大文件分块上传、断点续传

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { logError } from '@/lib/error-log'
import { authenticationErrorResponse } from '@/lib/api/auth-wrapper'
import {
  chunkObjectPath,
  validateChunkUpload,
  validateUploadCleanup,
  uploadCancellationPath,
} from '@/lib/documents/chunk-upload-protocol'

// 临时分块存储桶名称
const TEMP_BUCKET = 'contract-chunks'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req)

    const { id: contractId } = await params

    // 检查合同是否存在且有权限
    const { data: contract, error: fetchError } = await supabaseAdmin
      .from('contracts')
      .select('id, created_by, status')
      .eq('id', contractId)
      .single()

    if (fetchError || !contract) {
      return NextResponse.json({ error: '合同不存在' }, { status: 404 })
    }

    if (contract.created_by !== user.id) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }

    // 获取表单数据
    const formData = await req.formData()
    const chunkValue = formData.get('chunk')
    const chunk = chunkValue instanceof Blob ? chunkValue : null
    const index = Number(formData.get('index'))
    const start = Number(formData.get('start'))
    const end = Number(formData.get('end'))
    const totalSize = Number(formData.get('totalSize'))
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
      return NextResponse.json({ error: '无效的分块数据' }, { status: 400 })
    }

    const validation = validateChunkUpload({
      index,
      start,
      end,
      totalSize,
      chunkSize: chunk.size,
      fileName,
      uploadId,
      expectedSha256,
    })
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // 生成临时分块路径
    const tempPath = chunkObjectPath(contractId, uploadId, index)

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
      return NextResponse.json({ error: '分块上传失败' }, { status: 500 })
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
    const authResponse = authenticationErrorResponse(error)
    if (authResponse) return authResponse

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
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(req)
    const { id: contractId } = await params
    const { uploadId, chunkCount } = await req.json()
    const validation = validateUploadCleanup({ uploadId, chunkCount })
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const { data: contract, error: fetchError } = await supabaseAdmin
      .from('contracts')
      .select('id, created_by, updated_at, storage_path')
      .eq('id', contractId)
      .single()

    if (fetchError || !contract) {
      return NextResponse.json({ error: '合同不存在' }, { status: 404 })
    }
    if (contract.created_by !== user.id) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }
    if (typeof contract.storage_path === 'string' && contract.storage_path.startsWith(`${contractId}/${uploadId}_`)) {
      return NextResponse.json({ error: '上传会话已经提交，不能再取消' }, { status: 409 })
    }

    // 先写会话取消标记，再推进合同版本栅栏。merge 若已读取旧版本会在 CAS 失败，
    // 若在取消后启动则会看到 marker；二者共同阻止取消后静默提交。
    const markerPath = uploadCancellationPath(contractId, uploadId)
    const { error: markerError } = await supabaseAdmin
      .storage
      .from(TEMP_BUCKET)
      .upload(markerPath, new Uint8Array([1]), {
        contentType: 'application/x-price-upload-cancelled',
        upsert: true,
      })
    if (markerError) {
      return NextResponse.json({ error: '无法标记上传会话为已取消' }, { status: 500 })
    }

    const { data: fencedContract, error: fenceError } = await supabaseAdmin
      .from('contracts')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', contractId)
      .eq('created_by', user.id)
      .eq('updated_at', contract.updated_at)
      .select('id')
      .maybeSingle()

    const paths = Array.from(
      { length: chunkCount },
      (_, index) => chunkObjectPath(contractId, uploadId, index)
    )
    const { error: cleanupError } = await supabaseAdmin
      .storage
      .from(TEMP_BUCKET)
      .remove(paths)

    if (cleanupError) {
      return NextResponse.json({ error: '取消上传时清理分块失败' }, { status: 500 })
    }

    if (fenceError || !fencedContract) {
      return NextResponse.json({ error: '上传已提交或合同状态已变化' }, { status: 409 })
    }

    return NextResponse.json({ success: true })
  } catch (error: unknown) {
    const authResponse = authenticationErrorResponse(error)
    if (authResponse) return authResponse

    const err = error as Error
    await logError({
      req,
      source: 'api',
      message: err.message,
      error,
      context: {
        route: '/api/contracts/[id]/upload-chunk',
        method: 'DELETE',
      },
    })
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
