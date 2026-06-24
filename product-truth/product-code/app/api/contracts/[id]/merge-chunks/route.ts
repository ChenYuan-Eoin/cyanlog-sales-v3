// POST /api/contracts/[id]/merge-chunks - 合并所有分块
// 将临时分块合并为完整文件，移动到正式存储

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { logError } from '@/lib/error-log'

const TEMP_BUCKET = 'contract-chunks'
const FINAL_BUCKET = 'contracts'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await requireAuth(req)
    if (!user) {
      return NextResponse.json({ error: '未登录' }, { status: 401 })
    }

    const contractId = params.id

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

    // 获取请求参数
    const { fileName, fileType, totalSize, chunkCount } = await req.json()

    if (!fileName || !chunkCount) {
      return NextResponse.json({ error: '缺少必要参数' }, { status: 400 })
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
        return NextResponse.json({ error: `下载分块 ${i} 失败` }, { status: 500 })
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
      return NextResponse.json({ error: '文件保存失败' }, { status: 500 })
    }

    // 获取文件 URL
    const { data: urlData } = supabaseAdmin
      .storage
      .from(FINAL_BUCKET)
      .getPublicUrl(finalPath)

    // 更新合同记录
    const { error: updateError } = await supabaseAdmin
      .from('contracts')
      .update({
        filename: fileName,
        storage_path: finalPath,
        size: totalSize,
        mime_type: fileType,
        updated_at: new Date().toISOString(),
      })
      .eq('id', contractId)

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
    }

    return NextResponse.json({
      success: true,
      data: {
        fileUrl: urlData.publicUrl,
        storagePath: finalPath,
        fileName,
        fileSize: totalSize,
        fileType,
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
        route: '/api/contracts/[id]/merge-chunks',
      },
    })
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
