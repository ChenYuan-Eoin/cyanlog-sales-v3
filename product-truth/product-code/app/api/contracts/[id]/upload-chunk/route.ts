// POST /api/contracts/[id]/upload-chunk - 上传单个分块
// 支持大文件分块上传、断点续传

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { logError } from '@/lib/error-log'

// 临时分块存储桶名称
const TEMP_BUCKET = 'contract-chunks'

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

    // 获取表单数据
    const formData = await req.formData()
    const chunk = formData.get('chunk') as Blob
    const index = parseInt(formData.get('index') as string, 10)
    const start = parseInt(formData.get('start') as string, 10)
    const end = parseInt(formData.get('end') as string, 10)
    const totalSize = parseInt(formData.get('totalSize') as string, 10)
    const fileName = formData.get('fileName') as string
    const fileType = formData.get('fileType') as string

    if (!chunk || isNaN(index)) {
      return NextResponse.json({ error: '无效的分块数据' }, { status: 400 })
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
