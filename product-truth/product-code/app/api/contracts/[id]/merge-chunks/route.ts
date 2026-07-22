// POST /api/contracts/[id]/merge-chunks - 合并所有分块
// 将临时分块合并为完整文件，移动到正式存储

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { logError } from '@/lib/error-log'
import { inspectContractSource } from '@/lib/documents/source-format'
import { extractPdfText } from '@/lib/documents/source-render'
import { extractCurrentWordText, WordSourceTextError } from '@/lib/documents/source-text'
import { authenticationErrorResponse } from '@/lib/api/auth-wrapper'
import {
  chunkObjectPath,
  expectedChunkBounds,
  uploadCancellationPath,
  validateMergeUpload,
} from '@/lib/documents/chunk-upload-protocol'

const TEMP_BUCKET = 'contract-chunks'
const FINAL_BUCKET = 'contracts'

async function storedObjectMatches(
  storagePath: string,
  expectedSize: number,
  expectedSha256: string
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.storage.from(FINAL_BUCKET).download(storagePath)
  if (error || !data) return false
  const bytes = new Uint8Array(await data.arrayBuffer())
  return bytes.byteLength === expectedSize
    && createHash('sha256').update(bytes).digest('hex') === expectedSha256.toLowerCase()
}

async function uploadWasCancelled(contractId: string, uploadId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin.storage
    .from(TEMP_BUCKET)
    .download(uploadCancellationPath(contractId, uploadId))
  return !error && Boolean(data)
}

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
      .select('id, created_by, status, storage_path, filename, size, mime_type, updated_at')
      .eq('id', contractId)
      .single()

    if (fetchError || !contract) {
      return NextResponse.json({ error: '合同不存在' }, { status: 404 })
    }

    if (contract.created_by !== user.id) {
      return NextResponse.json({ error: '无权限' }, { status: 403 })
    }
    if (contract.status === 'PARSING' || contract.status === 'ANALYZING') {
      return NextResponse.json({ error: '合同正在审核或复审，源文件已锁定' }, { status: 409 })
    }

    // 获取请求参数
    const {
      fileName,
      fileType,
      totalSize,
      chunkCount,
      uploadId,
      expectedSha256,
    } = await req.json()

    const validation = validateMergeUpload({
      fileName,
      totalSize,
      chunkCount,
      uploadId,
      expectedSha256,
    })
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    // uploadId 同时是正式对象的幂等键；同一会话重试不得制造第二个 source identity。
    const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_')
    const finalPath = `${contractId}/${uploadId}_${safeFileName}`
    const tempPaths = Array.from(
      { length: chunkCount },
      (_, index) => chunkObjectPath(contractId, uploadId, index)
    )

    const successResponse = (mimeType: string | null | undefined) => {
      const { data: urlData } = supabaseAdmin.storage.from(FINAL_BUCKET).getPublicUrl(finalPath)
      return NextResponse.json({
        success: true,
        data: {
          fileUrl: urlData.publicUrl,
          storagePath: finalPath,
          fileName,
          fileSize: totalSize,
          fileType: mimeType || 'application/octet-stream',
        },
        message: '上传成功',
      })
    }

    const cleanupTemporaryChunks = async () => {
      const { error: cleanupError } = await supabaseAdmin
        .storage
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
    }

    if (
      contract.storage_path === finalPath
      && contract.filename === fileName
      && contract.size === totalSize
    ) {
      if (!await storedObjectMatches(finalPath, totalSize, expectedSha256)) {
        return NextResponse.json({ error: '已提交源文件与上传摘要冲突' }, { status: 409 })
      }
      await cleanupTemporaryChunks()
      return successResponse(contract.mime_type)
    }

    if (await uploadWasCancelled(contractId, uploadId)) {
      return NextResponse.json({ error: '上传会话已取消' }, { status: 409 })
    }

    // 按顺序下载并合并所有分块
    const mergedArray = new Uint8Array(totalSize)
    let mergedOffset = 0

    for (let i = 0; i < chunkCount; i++) {
      const tempPath = tempPaths[i]

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
        return NextResponse.json({ error: `下载分块 ${i} 失败` }, { status: 500 })
      }

      const arrayBuffer = await chunkData.arrayBuffer()
      const chunk = new Uint8Array(arrayBuffer)
      const expected = expectedChunkBounds(i, totalSize)
      if (chunk.byteLength !== expected.end - expected.start) {
        return NextResponse.json({ error: `分块 ${i} 大小与上传声明不一致` }, { status: 400 })
      }
      mergedArray.set(chunk, mergedOffset)
      mergedOffset += chunk.byteLength
    }

    if (mergedOffset !== totalSize) {
      return NextResponse.json({ error: '分块合并后的文件大小与上传声明不一致' }, { status: 400 })
    }
    const actualSha256 = createHash('sha256').update(mergedArray).digest('hex')
    if (actualSha256 !== expectedSha256.toLowerCase()) {
      return NextResponse.json({ error: '文件摘要与上传声明不一致' }, { status: 400 })
    }

    const inspection = inspectContractSource(fileName, fileType, mergedArray)
    if (!inspection.ok) {
      return NextResponse.json({ error: inspection.error }, { status: 400 })
    }
    let parsedText: string | null = null
    try {
      parsedText = inspection.format === 'pdf'
        ? await extractPdfText(mergedArray)
        : inspection.format === 'docx' || inspection.format === 'docm'
          ? await extractCurrentWordText(mergedArray, inspection.format)
          : null
    } catch (error) {
      if (error instanceof WordSourceTextError) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }
      throw error
    }

    // 上传到正式存储
    const { error: uploadError } = await supabaseAdmin
      .storage
      .from(FINAL_BUCKET)
      .upload(finalPath, mergedArray, {
        contentType: inspection.mimeType || 'application/octet-stream',
        // 正式源文件路径不可覆盖；冲突时失败比静默换字节安全。
        upsert: false,
      })

    if (uploadError && !await storedObjectMatches(finalPath, totalSize, expectedSha256)) {
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
      return NextResponse.json({ error: '文件保存失败' }, { status: 500 })
    }


    if (await uploadWasCancelled(contractId, uploadId)) {
      const { data: latestContract, error: latestError } = await supabaseAdmin
        .from('contracts')
        .select('storage_path, filename, size, mime_type')
        .eq('id', contractId)
        .maybeSingle()
      if (latestError) {
        // Losing the ability to prove that an object is unreferenced is not
        // permission to delete it. Preserve the source and fail closed.
        return NextResponse.json({ error: '无法确认取消后的源文件引用状态' }, { status: 500 })
      }
      const sameSessionAlreadyCommitted = latestContract?.storage_path === finalPath
        && latestContract.filename === fileName
        && latestContract.size === totalSize
        && await storedObjectMatches(finalPath, totalSize, expectedSha256)
      if (sameSessionAlreadyCommitted) {
        await cleanupTemporaryChunks()
        return successResponse(latestContract?.mime_type)
      }
      // Never delete an object referenced by the current contract, even if its
      // metadata is inconsistent. A later repair can reconcile it safely.
      if (latestContract?.storage_path !== finalPath) {
        await supabaseAdmin.storage.from(FINAL_BUCKET).remove([finalPath])
      }
      await cleanupTemporaryChunks()
      return NextResponse.json({ error: '上传会话已取消' }, { status: 409 })
    }

    // 按开始合并时看到的 source identity 做 compare-and-set；并发标签页不能静默后写覆盖。
    let updateQuery = supabaseAdmin
      .from('contracts')
      .update({
        filename: fileName,
        storage_path: finalPath,
        size: mergedArray.byteLength,
        mime_type: inspection.mimeType,
        parsed_text: parsedText,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contractId)
      .eq('updated_at', contract.updated_at)

    updateQuery = contract.storage_path === null
      ? updateQuery.is('storage_path', null)
      : updateQuery.eq('storage_path', contract.storage_path)

    const { data: updatedContract, error: updateError } = await updateQuery
      .select('id')
      .maybeSingle()

    if (updateError || !updatedContract) {
      const { data: latestContract, error: latestError } = await supabaseAdmin
        .from('contracts')
        .select('storage_path, filename, size, mime_type')
        .eq('id', contractId)
        .maybeSingle()
      if (latestError) {
        await logError({
          req,
          source: 'api',
          userId: user.id,
          message: latestError.message || '无法确认合同是否已引用上传对象',
          error: latestError,
          context: {
            route: '/api/contracts/[id]/merge-chunks',
            contractId,
            phase: 'confirm_contract_after_cas',
          },
        })
        // The CAS response may have been lost after commit. Never delete the
        // deterministic object until a successful read proves it unreferenced.
        return NextResponse.json({ error: '无法确认源文件提交状态，请重试完成步骤' }, { status: 500 })
      }
      const sameSessionAlreadyCommitted = !latestError
        && latestContract?.storage_path === finalPath
        && latestContract.filename === fileName
        && latestContract.size === totalSize
        && await storedObjectMatches(finalPath, totalSize, expectedSha256)

      if (sameSessionAlreadyCommitted) {
        await cleanupTemporaryChunks()
        return successResponse(latestContract?.mime_type)
      }

      // 只有确认当前合同没有引用本会话对象时才清理，避免删除并发同会话已提交源。
      if (latestContract?.storage_path !== finalPath) {
        await supabaseAdmin.storage.from(FINAL_BUCKET).remove([finalPath])
      }
      await logError({
        req,
        source: 'api',
        userId: user.id,
        message: updateError?.message || '合同源文件记录发生并发变化',
        error: updateError || latestError,
        context: {
          route: '/api/contracts/[id]/merge-chunks',
          contractId,
          phase: 'update_contract',
        },
      })
      const isConflict = !updateError
        || updateError.code === '55000'
        || Boolean(latestContract && latestContract.storage_path !== contract.storage_path)
      return NextResponse.json({
        error: updateError?.code === '55000'
          ? '复审批次已锁定源文件，请等待完成后再上传'
          : isConflict
          ? '源文件已被另一上传更新，请刷新后重试'
          : '文件已合并但合同记录更新失败，正式对象已清理',
      }, { status: isConflict ? 409 : 500 })
    }

    // 只有正式对象与数据库记录均成功后才清理临时分块。失败时保留分块，
    // 允许调用方重试 merge，避免一次瞬时故障触发整个 50MB 文件重传。
    await cleanupTemporaryChunks()

    return successResponse(inspection.mimeType)
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
        route: '/api/contracts/[id]/merge-chunks',
      },
    })
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
