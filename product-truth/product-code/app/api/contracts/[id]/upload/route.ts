// POST /api/contracts/[id]/upload - 上传合同文件
// REQ: F005

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { requireAuth } from '@/lib/auth'
import { logError } from '@/lib/error-log'

const ALLOWED_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/jpg',
]

const MAX_SIZE = 10 * 1024 * 1024 // 10MB

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

    // 获取表单数据
    const formData = await req.formData()
    const file = formData.get('file') as File

    if (!file) {
      return NextResponse.json({ error: '未提供文件' }, { status: 400 })
    }

    // 验证文件类型
    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json(
        { error: '不支持的文件类型，请上传 PDF、Word 或图片' },
        { status: 400 }
      )
    }

    // 验证文件大小
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: '文件大小超过 10MB 限制' },
        { status: 400 }
      )
    }

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

    // 生成存储路径：contracts/{contractId}/{timestamp}_{filename}
    const timestamp = Date.now()
    const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const storagePath = `${contractId}/${timestamp}_${safeFileName}`

    // 上传文件到 Supabase Storage
    const { data: uploadData, error: uploadError } = await supabaseAdmin
      .storage
      .from('contracts')
      .upload(storagePath, file, {
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
      return NextResponse.json({ error: '上传失败' }, { status: 500 })
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
        mime_type: file.type,
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
  } catch (error: any) {
    await logError({
      req,
      source: 'api',
      message: error.message,
      error,
      context: {
        route: '/api/contracts/[id]/upload',
      },
    })
    return NextResponse.json({ error: '服务器错误' }, { status: 500 })
  }
}
